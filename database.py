import sqlite3
import os
import requests
import xml.etree.ElementTree as ET

DB_PATH = "aceituna.db"

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Inicializa la base de datos con soporte para múltiples campañas y relaciones dinámicas."""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Habilitar claves foráneas
    cursor.execute("PRAGMA foreign_keys = ON;")
    
    # 1. Tabla de Campañas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS campanas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        activa INTEGER DEFAULT 0
    )
    """)
    
    # 2. Tabla Global de Fincas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS fincas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL,
        provincia TEXT,
        municipio TEXT,
        poligono INTEGER,
        parcela INTEGER,
        referencia_catastral TEXT,
        superficie_m2 REAL,
        latitude REAL,
        longitude REAL,
        localizacion TEXT
    )
    """)

    # Auto-migración para añadir campos catastrales a fincas si no existen
    cursor.execute("PRAGMA table_info(fincas)")
    fincas_cols = [c[1] for c in cursor.fetchall()]
    nuevas_columnas_finca = [
        ("provincia", "TEXT"),
        ("municipio", "TEXT"),
        ("poligono", "INTEGER"),
        ("parcela", "INTEGER"),
        ("referencia_catastral", "TEXT"),
        ("superficie_m2", "REAL"),
        ("latitude", "REAL"),
        ("longitude", "REAL"),
        ("localizacion", "TEXT")
    ]
    for col_name, col_type in nuevas_columnas_finca:
        if col_name not in fincas_cols:
            cursor.execute(f"ALTER TABLE fincas ADD COLUMN {col_name} {col_type}")
            
    # 2.5 Tabla Global de Parcelas Catastrales (Soporte Multiparcera por Finca)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS finca_parcelas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        finca_id INTEGER NOT NULL,
        provincia TEXT NOT NULL,
        municipio TEXT NOT NULL,
        poligono INTEGER NOT NULL,
        parcela INTEGER NOT NULL,
        referencia_catastral TEXT,
        superficie_m2 REAL,
        latitude REAL,
        longitude REAL,
        localizacion TEXT,
        FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE
    )
    """)
    
    # Auto-migración: Si finca_parcelas está vacía pero la tabla fincas tiene datos catastrales configurados,
    # migramos esos datos a finca_parcelas para no perderlos.
    cursor.execute("SELECT COUNT(*) FROM finca_parcelas")
    if cursor.fetchone()[0] == 0:
        cursor.execute("SELECT id, provincia, municipio, poligono, parcela, referencia_catastral, superficie_m2, latitude, longitude, localizacion FROM fincas WHERE poligono IS NOT NULL AND parcela IS NOT NULL")
        old_data = cursor.fetchall()
        for row in old_data:
            cursor.execute("""
                INSERT INTO finca_parcelas (finca_id, provincia, municipio, poligono, parcela, referencia_catastral, superficie_m2, latitude, longitude, localizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9]))
    
    # 3. Tabla Global de Trabajadores
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS trabajadores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT UNIQUE NOT NULL
    )
    """)
    
    # 4. Tabla Relacional: Fincas asignadas a una Campaña
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS campana_fincas (
        campana_id INTEGER,
        finca_id INTEGER,
        PRIMARY KEY (campana_id, finca_id),
        FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
        FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE
    )
    """)
    
    # 5. Tabla Relacional: Trabajadores asignados a una Campaña
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS campana_trabajadores (
        campana_id INTEGER,
        trabajador_id INTEGER,
        PRIMARY KEY (campana_id, trabajador_id),
        FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
        FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE CASCADE
    )
    """)
    
    # 6. Tabla de Registro de Horas (Asociada a Campaña, Finca y Trabajador)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS registro_horas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        campana_id INTEGER NOT NULL,
        finca_id INTEGER NOT NULL,
        trabajador_id INTEGER NOT NULL,
        fecha TEXT NOT NULL,  -- Formato YYYY-MM-DD
        horas REAL NOT NULL,
        trabajo TEXT NOT NULL DEFAULT 'RECOLECTA',
        FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
        FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE,
        FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE CASCADE,
        UNIQUE(campana_id, finca_id, trabajador_id, fecha, trabajo)
    )
    """)
    
    # Auto-migración para añadir columna 'trabajo' si no existe
    cursor.execute("PRAGMA table_info(registro_horas)")
    cols = [c[1] for c in cursor.fetchall()]
    if "trabajo" not in cols:
        cursor.execute("ALTER TABLE registro_horas RENAME TO registro_horas_old")
        cursor.execute("""
        CREATE TABLE registro_horas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campana_id INTEGER NOT NULL,
            finca_id INTEGER NOT NULL,
            trabajador_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            horas REAL NOT NULL,
            trabajo TEXT NOT NULL DEFAULT 'RECOLECTA',
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE,
            FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE CASCADE,
            UNIQUE(campana_id, finca_id, trabajador_id, fecha, trabajo)
        )
        """)
        cursor.execute("""
        INSERT INTO registro_horas (id, campana_id, finca_id, trabajador_id, fecha, horas, trabajo)
        SELECT id, campana_id, finca_id, trabajador_id, fecha, horas, 'RECOLECTA' FROM registro_horas_old
        """)
        cursor.execute("DROP TABLE registro_horas_old")
    
    # 7. Tabla Relacional: Trabajadores asignados a una Finca concreta en una Campaña
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS campana_finca_trabajadores (
        campana_id INTEGER NOT NULL,
        finca_id INTEGER NOT NULL,
        trabajador_id INTEGER NOT NULL,
        PRIMARY KEY (campana_id, finca_id, trabajador_id),
        FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
        FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE,
        FOREIGN KEY (trabajador_id) REFERENCES trabajadores(id) ON DELETE CASCADE
    )
    """)
    
    # Auto-poblar asignaciones finca-trabajador desde el historial de horas registradas
    cursor.execute("""
    INSERT OR IGNORE INTO campana_finca_trabajadores (campana_id, finca_id, trabajador_id)
    SELECT DISTINCT campana_id, finca_id, trabajador_id
    FROM registro_horas
    WHERE horas > 0
    """)
    
    # --- MIGRACIÓN AUTOMÁTICA DE REGISTRO_KILOS ---
    # Comprobar si existe la tabla vieja y si tiene la columna 'kilos_arbol'
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='registro_kilos'")
    table_exists = cursor.fetchone()
    
    needs_migration = False
    if table_exists:
        cursor.execute("PRAGMA table_info(registro_kilos)")
        cols = [r['name'] for r in cursor.fetchall()]
        if 'kilos_arbol' in cols:
            needs_migration = True
            
    if needs_migration:
        print("Base de datos: Detectada estructura antigua. Ejecutando migración automática...")
        # 1. Leer registros viejos
        cursor.execute("SELECT * FROM registro_kilos")
        old_records = cursor.fetchall()
        
        # 2. Renombrar tabla vieja
        cursor.execute("ALTER TABLE registro_kilos RENAME TO old_registro_kilos")
        
        # 3. Crear nueva tabla de registro_kilos (soporta múltiples entregas)
        cursor.execute("""
        CREATE TABLE registro_kilos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campana_id INTEGER NOT NULL,
            finca_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,  -- Formato YYYY-MM-DD
            tipo TEXT NOT NULL,   -- 'ARBOL' o 'SUELO'
            kilos REAL NOT NULL,
            rendimiento REAL NOT NULL,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE
        )
        """)
        
        # 4. Crear tabla de registro_incidencias
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS registro_incidencias (
            campana_id INTEGER NOT NULL,
            finca_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,  -- Formato YYYY-MM-DD
            incidencias TEXT,
            PRIMARY KEY (campana_id, finca_id, fecha),
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE
        )
        """)
        
        # 5. Migrar los registros viejos convirtiéndolos en entregas individuales
        for r in old_records:
            cid = r['campana_id']
            fid = r['finca_id']
            fecha = r['fecha']
            
            # Si había kilos de árbol, creamos entrega de árbol
            if r['kilos_arbol'] and float(r['kilos_arbol']) > 0:
                cursor.execute("""
                    INSERT INTO registro_kilos (campana_id, finca_id, fecha, tipo, kilos, rendimiento)
                    VALUES (?, ?, ?, 'ARBOL', ?, ?)
                """, (cid, fid, fecha, r['kilos_arbol'], r['rendimiento_arbol'] or 0))
                
            # Si había kilos de suelo, creamos entrega de suelo
            if r['kilos_suelo'] and float(r['kilos_suelo']) > 0:
                cursor.execute("""
                    INSERT INTO registro_kilos (campana_id, finca_id, fecha, tipo, kilos, rendimiento)
                    VALUES (?, ?, ?, 'SUELO', ?, ?)
                """, (cid, fid, fecha, r['kilos_suelo'], r['rendimiento_suelo'] or 0))
                
            # Si había incidencias, las migramos a la nueva tabla
            if r['incidencias'] and str(r['incidencias']).strip():
                cursor.execute("""
                    INSERT OR REPLACE INTO registro_incidencias (campana_id, finca_id, fecha, incidencias)
                    VALUES (?, ?, ?, ?)
                """, (cid, fid, fecha, r['incidencias']))
                
        # 6. Eliminar tabla temporal de respaldo
        cursor.execute("DROP TABLE old_registro_kilos")
        print("Base de datos: Migración automática completada con éxito.")
    else:
        # Si no existía o ya es nueva, crear las tablas normales
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS registro_kilos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campana_id INTEGER NOT NULL,
            finca_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            tipo TEXT NOT NULL,  -- 'ARBOL' o 'SUELO'
            kilos REAL NOT NULL,
            rendimiento REAL NOT NULL,
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE
        )
        """)
        
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS registro_incidencias (
            campana_id INTEGER NOT NULL,
            finca_id INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            incidencias TEXT,
            PRIMARY KEY (campana_id, finca_id, fecha),
            FOREIGN KEY (campana_id) REFERENCES campanas(id) ON DELETE CASCADE,
            FOREIGN KEY (finca_id) REFERENCES fincas(id) ON DELETE CASCADE
        )
        """)
        
    conn.commit()
    conn.close()

# --- GESTIÓN DE CAMPAÑAS ---

def get_campanas():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM campanas ORDER BY nombre DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_campana_activa():
    conn = get_connection()
    row = conn.execute("SELECT * FROM campanas WHERE activa = 1 LIMIT 1").fetchone()
    if not row:
        row = conn.execute("SELECT * FROM campanas ORDER BY id DESC LIMIT 1").fetchone()
    conn.close()
    return dict(row) if row else None

def add_campana(nombre):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO campanas (nombre) VALUES (?)", (nombre.strip().upper(),))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def set_campana_activa(campana_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("UPDATE campanas SET activa = 0")
    cursor.execute("UPDATE campanas SET activa = 1 WHERE id = ?", (campana_id,))
    conn.commit()
    conn.close()

# --- CATÁLOGO GLOBAL ---

def get_global_fincas():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM fincas ORDER BY nombre").fetchall()
    fincas = [dict(r) for r in rows]
    for f in fincas:
        p_rows = conn.execute("SELECT * FROM finca_parcelas WHERE finca_id = ?", (f['id'],)).fetchall()
        f['parcelas'] = [dict(p) for p in p_rows]
    conn.close()
    return fincas

def add_finca_global(nombre, parcelas=None):
    if parcelas is None:
        parcelas = []
    conn = get_connection()
    try:
        cursor = conn.cursor()
        
        # Compatibilidad: Usar primera parcela para rellenar campos directos de la tabla fincas
        first = parcelas[0] if parcelas else {}
        
        cursor.execute("""
            INSERT INTO fincas (nombre, provincia, municipio, poligono, parcela, referencia_catastral, superficie_m2, latitude, longitude, localizacion)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            nombre.strip().upper(),
            first.get("provincia", "").strip().upper() if first.get("provincia") else None,
            first.get("municipio", "").strip().upper() if first.get("municipio") else None,
            first.get("poligono"),
            first.get("parcela"),
            first.get("referencia_catastral"),
            first.get("superficie_m2"),
            first.get("latitude"),
            first.get("longitude"),
            first.get("localizacion")
        ))
        finca_id = cursor.lastrowid
        
        for p in parcelas:
            cursor.execute("""
                INSERT INTO finca_parcelas (finca_id, provincia, municipio, poligono, parcela, referencia_catastral, superficie_m2, latitude, longitude, localizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                finca_id,
                p.get("provincia", "JAEN").strip().upper(),
                p.get("municipio", "ALCALA LA REAL").strip().upper(),
                p.get("poligono"),
                p.get("parcela"),
                p.get("referencia_catastral"),
                p.get("superficie_m2"),
                p.get("latitude"),
                p.get("longitude"),
                p.get("localizacion")
            ))
        conn.commit()
        return finca_id
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

def get_global_trabajadores():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM trabajadores ORDER BY nombre").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def add_trabajador_global(nombre):
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("INSERT INTO trabajadores (nombre) VALUES (?)", (nombre.strip().upper(),))
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None
    finally:
        conn.close()

# --- ASIGNACIONES A CAMPAÑA ---

def get_campana_fincas(campana_id):
    conn = get_connection()
    rows = conn.execute("""
        SELECT f.* FROM fincas f
        JOIN campana_fincas cf ON f.id = cf.finca_id
        WHERE cf.campana_id = ?
        ORDER BY f.nombre
    """, (campana_id,)).fetchall()
    fincas = [dict(r) for r in rows]
    for f in fincas:
        p_rows = conn.execute("SELECT * FROM finca_parcelas WHERE finca_id = ?", (f['id'],)).fetchall()
        f['parcelas'] = [dict(p) for p in p_rows]
    conn.close()
    return fincas

def asignar_fincas_a_campana(campana_id, finca_ids):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM campana_fincas WHERE campana_id = ?", (campana_id,))
    for fid in finca_ids:
        cursor.execute("INSERT INTO campana_fincas (campana_id, finca_id) VALUES (?, ?)", (campana_id, fid))
    conn.commit()
    conn.close()

def get_campana_trabajadores(campana_id):
    conn = get_connection()
    rows = conn.execute("""
        SELECT t.* FROM trabajadores t
        JOIN campana_trabajadores ct ON t.id = ct.trabajador_id
        WHERE ct.campana_id = ?
        ORDER BY t.nombre
    """, (campana_id,)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def asignar_trabajadores_a_campana(campana_id, trabajador_ids):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM campana_trabajadores WHERE campana_id = ?", (campana_id,))
    for tid in trabajador_ids:
        cursor.execute("INSERT INTO campana_trabajadores (campana_id, trabajador_id) VALUES (?, ?)", (campana_id, tid))
    conn.commit()
    conn.close()

# --- REGISTRO DE HORAS ---

def guardar_horas(campana_id, finca_id, trabajador_id, fecha, horas, trabajo='RECOLECTA'):
    conn = get_connection()
    if horas <= 0:
        conn.execute("""
            DELETE FROM registro_horas 
            WHERE campana_id = ? AND finca_id = ? AND trabajador_id = ? AND fecha = ? AND trabajo = ?
        """, (campana_id, finca_id, trabajador_id, fecha, trabajo.strip().upper()))
    else:
        conn.execute("""
            INSERT INTO registro_horas (campana_id, finca_id, trabajador_id, fecha, horas, trabajo)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(campana_id, finca_id, trabajador_id, fecha, trabajo) DO UPDATE SET horas = excluded.horas
        """, (campana_id, finca_id, trabajador_id, fecha, horas, trabajo.strip().upper()))
    conn.commit()
    conn.close()

def obtener_horas_dia(campana_id, finca_id, fecha, trabajo='RECOLECTA'):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT trabajador_id, horas 
        FROM registro_horas 
        WHERE campana_id = ? AND finca_id = ? AND fecha = ? AND trabajo = ?
    """, (campana_id, finca_id, fecha, trabajo.strip().upper()))
    rows = cursor.fetchall()
    conn.close()
    return {row['trabajador_id']: row['horas'] for row in rows}

# --- REGISTRO DE ENTREGAS DE KILOS (ENTREGAS INDIVIDUALES) ---

def agregar_entrega(campana_id, finca_id, fecha, tipo, kilos, rendimiento):
    """Añade una entrega de aceituna en una fecha y finca concreta."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO registro_kilos (campana_id, finca_id, fecha, tipo, kilos, rendimiento)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (campana_id, finca_id, fecha, tipo.strip().upper(), kilos, rendimiento))
    conn.commit()
    row_id = cursor.lastrowid
    conn.close()
    return row_id

def eliminar_entrega(entrega_id):
    """Elimina una entrega de aceituna por su ID."""
    conn = get_connection()
    conn.execute("DELETE FROM registro_kilos WHERE id = ?", (entrega_id,))
    conn.commit()
    conn.close()

def obtener_entregas_dia(campana_id, finca_id, fecha):
    """Obtiene el listado de todas las entregas de un día concreto en una finca."""
    conn = get_connection()
    rows = conn.execute("""
        SELECT id, tipo, kilos, rendimiento 
        FROM registro_kilos 
        WHERE campana_id = ? AND finca_id = ? AND fecha = ?
        ORDER BY id ASC
    """, (campana_id, finca_id, fecha)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# --- REGISTRO DE INCIDENCIAS ---

def guardar_incidencia(campana_id, finca_id, fecha, incidencias):
    """Guarda o actualiza las incidencias/notas diarias de una finca."""
    conn = get_connection()
    conn.execute("""
        INSERT INTO registro_incidencias (campana_id, finca_id, fecha, incidencias)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(campana_id, finca_id, fecha) DO UPDATE SET incidencias = excluded.incidencias
    """, (campana_id, finca_id, fecha, incidencias))
    conn.commit()
    conn.close()

def obtener_incidencia_dia(campana_id, finca_id, fecha):
    """Obtiene la incidencia registrada para una fecha y finca."""
    conn = get_connection()
    row = conn.execute("""
        SELECT incidencias 
        FROM registro_incidencias 
        WHERE campana_id = ? AND finca_id = ? AND fecha = ?
    """, (campana_id, finca_id, fecha)).fetchone()
    conn.close()
    return row['incidencias'] if row else ""

# --- DETECCION DE ACTIVIDAD ---

def obtener_fincas_con_actividad(campana_id, fecha):
    """Busca qué fincas tienen algún registro (horas, kilos o incidencias) en una fecha."""
    conn = get_connection()
    
    # Fincas con horas
    fincas_horas = [r[0] for r in conn.execute("""
        SELECT DISTINCT finca_id FROM registro_horas WHERE campana_id = ? AND fecha = ?
    """, (campana_id, fecha)).fetchall()]
    
    # Fincas con entregas de kilos
    fincas_kilos = [r[0] for r in conn.execute("""
        SELECT DISTINCT finca_id FROM registro_kilos WHERE campana_id = ? AND fecha = ?
    """, (campana_id, fecha)).fetchall()]
    
    # Fincas con incidencias
    fincas_inc = [r[0] for r in conn.execute("""
        SELECT DISTINCT finca_id FROM registro_incidencias WHERE campana_id = ? AND fecha = ?
    """, (campana_id, fecha)).fetchall()]
    
    conn.close()
    return list(set(fincas_horas + fincas_kilos + fincas_inc))

# --- REPORTES Y CONSULTAS CONSOLIDADAS ---

def obtener_cuadrante_finca(campana_id, finca_id):
    """
    Obtiene todos los registros consolidados por día de una finca.
    Los kilos de las entregas se suman, y los rendimientos calculan su media armónica diaria.
    """
    conn = get_connection()
    
    # 1. Obtener producción diaria consolidada (Árbol vs Suelo)
    prod_rows = conn.execute("""
        SELECT 
            fecha,
            SUM(CASE WHEN tipo = 'ARBOL' THEN kilos ELSE 0 END) as kilos_arbol,
            
            CASE WHEN SUM(CASE WHEN tipo = 'ARBOL' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END) > 0
                 THEN COUNT(CASE WHEN tipo = 'ARBOL' AND rendimiento > 0 THEN 1 END) / SUM(CASE WHEN tipo = 'ARBOL' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END)
                 ELSE 0 END as rendimiento_arbol,
                 
            SUM(CASE WHEN tipo = 'SUELO' THEN kilos ELSE 0 END) as kilos_suelo,
            
            CASE WHEN SUM(CASE WHEN tipo = 'SUELO' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END) > 0
                 THEN COUNT(CASE WHEN tipo = 'SUELO' AND rendimiento > 0 THEN 1 END) / SUM(CASE WHEN tipo = 'SUELO' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END)
                 ELSE 0 END as rendimiento_suelo
        FROM registro_kilos
        WHERE campana_id = ? AND finca_id = ?
        GROUP BY fecha
        ORDER BY fecha
    """, (campana_id, finca_id)).fetchall()
    
    # 2. Obtener incidencias diarias
    inc_rows = conn.execute("""
        SELECT fecha, incidencias
        FROM registro_incidencias
        WHERE campana_id = ? AND finca_id = ?
    """, (campana_id, finca_id)).fetchall()
    inc_by_date = {r['fecha']: r['incidencias'] for r in inc_rows}
    
    # 3. Obtener horas diarias (Consolidado de todas las labores)
    horas_rows = conn.execute("""
        SELECT fecha, trabajador_id, SUM(horas) as horas
        FROM registro_horas
        WHERE campana_id = ? AND finca_id = ?
        GROUP BY fecha, trabajador_id
        ORDER BY fecha
    """, (campana_id, finca_id)).fetchall()
    
    conn.close()
    
    horas_por_fecha = {}
    for h in horas_rows:
        fecha = h['fecha']
        if fecha not in horas_por_fecha:
            horas_por_fecha[fecha] = {}
        horas_por_fecha[fecha][h['trabajador_id']] = h['horas']
        
    cuadrante = []
    todas_fechas = sorted(list(set([p['fecha'] for p in prod_rows] + list(inc_by_date.keys()) + list(horas_por_fecha.keys()))))
    prod_by_date = {p['fecha']: dict(p) for p in prod_rows}
    
    for f in todas_fechas:
        prod = prod_by_date.get(f, {
            "kilos_arbol": 0, "rendimiento_arbol": 0,
            "kilos_suelo": 0, "rendimiento_suelo": 0
        })
        cuadrante.append({
            "fecha": f,
            "kilos_arbol": prod["kilos_arbol"],
            "rendimiento_arbol": prod["rendimiento_arbol"],
            "kilos_suelo": prod["kilos_suelo"],
            "rendimiento_suelo": prod["rendimiento_suelo"],
            "incidencias": inc_by_date.get(f, ""),
            "horas": horas_por_fecha.get(f, {})
        })
        
    return cuadrante

def obtener_resumen_general(campana_id):
    conn = get_connection()
    
    # 1. Totales de Kilos
    kilos = conn.execute("""
        SELECT 
            SUM(CASE WHEN tipo = 'ARBOL' THEN kilos ELSE 0 END) as total_arbol,
            SUM(CASE WHEN tipo = 'SUELO' THEN kilos ELSE 0 END) as total_suelo,
            SUM(kilos) as total_general
        FROM registro_kilos
        WHERE campana_id = ?
    """, (campana_id,)).fetchone()
    
    # 2. Rendimientos Medios (Media armónica de todas las entregas individuales)
    rendimientos = conn.execute("""
        SELECT 
            COUNT(CASE WHEN tipo = 'ARBOL' AND rendimiento > 0 THEN 1 END) / 
            SUM(CASE WHEN tipo = 'ARBOL' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END) as rend_medio_arbol,
            
            COUNT(CASE WHEN tipo = 'SUELO' AND rendimiento > 0 THEN 1 END) / 
            SUM(CASE WHEN tipo = 'SUELO' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END) as rend_medio_suelo,
            
            COUNT(CASE WHEN rendimiento > 0 THEN 1 END) / 
            SUM(CASE WHEN rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END) as rend_medio_general
        FROM registro_kilos
        WHERE campana_id = ?
    """, (campana_id,)).fetchone()
    
    # 3. Horas por trabajador y mes
    horas_mes = conn.execute("""
        SELECT 
            t.nombre as trabajador,
            strftime('%m', h.fecha) as mes_num,
            SUM(h.horas) as total_horas
        FROM registro_horas h
        JOIN trabajadores t ON h.trabajador_id = t.id
        WHERE h.campana_id = ?
        GROUP BY t.nombre, mes_num
        ORDER BY t.nombre, mes_num
    """, (campana_id,)).fetchall()
    
    # 4. Total de días y horas
    horas_totales_campana = conn.execute("""
        SELECT 
            t.nombre as trabajador,
            COUNT(DISTINCT h.fecha) as dias_trabajados,
            SUM(h.horas) as horas_totales
        FROM registro_horas h
        JOIN trabajadores t ON h.trabajador_id = t.id
        WHERE h.campana_id = ?
        GROUP BY t.nombre
        ORDER BY t.nombre
    """, (campana_id,)).fetchall()
    
    conn.close()
    
    nombres_meses = {
        "11": "Noviembre",
        "12": "Diciembre",
        "01": "Enero",
        "02": "Febrero",
        "03": "Marzo"
    }
    
    horas_desglose = {}
    for r in horas_mes:
        t = r['trabajador']
        mes = nombres_meses.get(r['mes_num'], f"Mes {r['mes_num']}")
        if t not in horas_desglose:
            horas_desglose[t] = {}
        horas_desglose[t][mes] = r['total_horas']
        
    return {
        "kilos": {
            "total_arbol": kilos['total_arbol'] or 0,
            "total_suelo": kilos['total_suelo'] or 0,
            "total_general": kilos['total_general'] or 0
        },
        "rendimientos": {
            "rend_medio_arbol": rendimientos['rend_medio_arbol'] or 0,
            "rend_medio_suelo": rendimientos['rend_medio_suelo'] or 0,
            "rend_medio_general": rendimientos['rend_medio_general'] or 0
        },
        "trabajadores_desglose": horas_desglose,
        "trabajadores_campana": [dict(tc) for tc in horas_totales_campana]
    }

def obtener_historial_campanas():
    """Obtiene los datos consolidados agrupados por campaña para el Historial."""
    conn = get_connection()
    rows = conn.execute("""
        SELECT 
            c.id as campana_id,
            c.nombre as campana_nombre,
            COALESCE(SUM(CASE WHEN rk.tipo = 'ARBOL' THEN rk.kilos ELSE 0 END), 0) as total_arbol,
            COALESCE(SUM(CASE WHEN rk.tipo = 'SUELO' THEN rk.kilos ELSE 0 END), 0) as total_suelo,
            COALESCE(SUM(rk.kilos), 0) as total_general,
            
            -- Media armónica de árbol
            CASE WHEN SUM(CASE WHEN rk.tipo = 'ARBOL' AND rk.rendimiento > 0 THEN 1.0 / rk.rendimiento ELSE 0 END) > 0 
                 THEN COUNT(CASE WHEN rk.tipo = 'ARBOL' AND rk.rendimiento > 0 THEN 1 END) / SUM(CASE WHEN rk.tipo = 'ARBOL' AND rk.rendimiento > 0 THEN 1.0 / rk.rendimiento ELSE 0 END)
                 ELSE 0 END as rend_medio_arbol,
                 
            -- Media armónica de suelo
            CASE WHEN SUM(CASE WHEN rk.tipo = 'SUELO' AND rk.rendimiento > 0 THEN 1.0 / rk.rendimiento ELSE 0 END) > 0 
                 THEN COUNT(CASE WHEN rk.tipo = 'SUELO' AND rk.rendimiento > 0 THEN 1 END) / SUM(CASE WHEN rk.tipo = 'SUELO' AND rk.rendimiento > 0 THEN 1.0 / rk.rendimiento ELSE 0 END)
                 ELSE 0 END as rend_medio_suelo,
                 
            -- Media armónica general
            CASE WHEN SUM(CASE WHEN rk.rendimiento > 0 THEN 1.0 / rk.rendimiento ELSE 0 END) > 0
                 THEN COUNT(CASE WHEN rk.rendimiento > 0 THEN 1 END) / SUM(CASE WHEN rk.rendimiento > 0 THEN 1.0 / rk.rendimiento ELSE 0 END)
                 ELSE 0 END as rend_medio_general
        FROM campanas c
        LEFT JOIN registro_kilos rk ON c.id = rk.campana_id
        GROUP BY c.id, c.nombre
        ORDER BY c.nombre DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# --- ASIGNACIONES TRABAJADORES POR FINCA ---

def asignar_trabajadores_a_finca(campana_id, finca_id, trabajador_ids):
    """Guarda la lista de trabajadores asignados a una finca en una campaña."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        DELETE FROM campana_finca_trabajadores 
        WHERE campana_id = ? AND finca_id = ?
    """, (campana_id, finca_id))
    for tid in trabajador_ids:
        cursor.execute("""
            INSERT INTO campana_finca_trabajadores (campana_id, finca_id, trabajador_id)
            VALUES (?, ?, ?)
        """, (campana_id, finca_id, tid))
    conn.commit()
    conn.close()

def obtener_trabajadores_finca(campana_id, finca_id):
    """Obtiene los trabajadores asignados a una finca específica en una campaña."""
    conn = get_connection()
    rows = conn.execute("""
        SELECT t.* FROM trabajadores t
        JOIN campana_finca_trabajadores cft ON t.id = cft.trabajador_id
        WHERE cft.campana_id = ? AND cft.finca_id = ?
        ORDER BY t.nombre
    """, (campana_id, finca_id)).fetchall()
    conn.close()
    return [dict(r) for r in rows]

# --- EDICIÓN Y BORRADO DE CATÁLOGO GLOBAL ---

def editar_finca_global(finca_id, nuevo_nombre, parcelas=None):
    """Edita el nombre y datos catastrales de una finca en el catálogo global."""
    if parcelas is None:
        parcelas = []
    conn = get_connection()
    try:
        cursor = conn.cursor()
        
        # Compatibilidad: Usar primera parcela para rellenar campos directos de la tabla fincas
        first = parcelas[0] if parcelas else {}
        
        cursor.execute("""
            UPDATE fincas 
            SET nombre = ?, provincia = ?, municipio = ?, poligono = ?, parcela = ?, referencia_catastral = ?, superficie_m2 = ?, latitude = ?, longitude = ?, localizacion = ?
            WHERE id = ?
        """, (
            nuevo_nombre.strip().upper(),
            first.get("provincia", "").strip().upper() if first.get("provincia") else None,
            first.get("municipio", "").strip().upper() if first.get("municipio") else None,
            first.get("poligono"),
            first.get("parcela"),
            first.get("referencia_catastral"),
            first.get("superficie_m2"),
            first.get("latitude"),
            first.get("longitude"),
            first.get("localizacion"),
            finca_id
        ))
        
        # Reemplazar todas las parcelas en la tabla finca_parcelas
        cursor.execute("DELETE FROM finca_parcelas WHERE finca_id = ?", (finca_id,))
        for p in parcelas:
            cursor.execute("""
                INSERT INTO finca_parcelas (finca_id, provincia, municipio, poligono, parcela, referencia_catastral, superficie_m2, latitude, longitude, localizacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                finca_id,
                p.get("provincia", "JAEN").strip().upper(),
                p.get("municipio", "ALCALA LA REAL").strip().upper(),
                p.get("poligono"),
                p.get("parcela"),
                p.get("referencia_catastral"),
                p.get("superficie_m2"),
                p.get("latitude"),
                p.get("longitude"),
                p.get("localizacion")
            ))
            
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def eliminar_finca_global(finca_id):
    """Elimina una finca del catálogo global (borrado en cascada)."""
    conn = get_connection()
    conn.execute("DELETE FROM fincas WHERE id = ?", (finca_id,))
    conn.commit()
    conn.close()

def editar_trabajador_global(trabajador_id, nuevo_nombre):
    """Edita el nombre de un trabajador en el catálogo global."""
    conn = get_connection()
    try:
        conn.execute("UPDATE trabajadores SET nombre = ? WHERE id = ?", (nuevo_nombre.strip().upper(), trabajador_id))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def eliminar_trabajador_global(trabajador_id):
    """Elimina un trabajador del catálogo global (borrado en cascada)."""
    conn = get_connection()
    conn.execute("DELETE FROM trabajadores WHERE id = ?", (trabajador_id,))
    conn.commit()
    conn.close()

# --- ANÁLISIS COMPARATIVO ---

def obtener_comparativa_campanas():
    """Obtiene datos generales comparativos de todas las campañas."""
    conn = get_connection()
    # Buscar todas las campañas
    campanas = conn.execute("SELECT id, nombre FROM campanas ORDER BY nombre DESC").fetchall()
    result = []
    
    for c in campanas:
        cid = c['id']
        cname = c['nombre']
        
        # Fincas activas en la campaña
        fincas_count = conn.execute("SELECT COUNT(*) FROM campana_fincas WHERE campana_id = ?", (cid,)).fetchone()[0]
        
        # Horas totales trabajadas en la campaña
        horas_sum = conn.execute("SELECT SUM(horas) FROM registro_horas WHERE campana_id = ?", (cid,)).fetchone()[0] or 0
        
        # Kilos totales
        kilos = conn.execute("""
            SELECT 
                SUM(CASE WHEN tipo = 'ARBOL' THEN kilos ELSE 0 END) as total_arbol,
                SUM(CASE WHEN tipo = 'SUELO' THEN kilos ELSE 0 END) as total_suelo,
                SUM(kilos) as total_general
            FROM registro_kilos
            WHERE campana_id = ?
        """, (cid,)).fetchone()
        
        result.append({
            "campana_id": cid,
            "campana_nombre": cname,
            "total_fincas": fincas_count,
            "total_horas": horas_sum,
            "kilos_total": kilos['total_general'] or 0,
            "kilos_arbol": kilos['total_arbol'] or 0,
            "kilos_suelo": kilos['total_suelo'] or 0
        })
    conn.close()
    return result

def obtener_comparativa_finca(finca_id):
    """Obtiene el histórico comparativo de una finca concreta a través de todas las campañas."""
    conn = get_connection()
    campanas = conn.execute("SELECT id, nombre FROM campanas ORDER BY nombre DESC").fetchall()
    result = []
    
    for c in campanas:
        cid = c['id']
        cname = c['nombre']
        
        # Horas totales en esta finca y campaña
        horas_sum = conn.execute("""
            SELECT SUM(horas) FROM registro_horas 
            WHERE campana_id = ? AND finca_id = ?
        """, (cid, finca_id)).fetchone()[0] or 0
        
        # Kilos totales
        kilos = conn.execute("""
            SELECT 
                SUM(CASE WHEN tipo = 'ARBOL' THEN kilos ELSE 0 END) as total_arbol,
                SUM(CASE WHEN tipo = 'SUELO' THEN kilos ELSE 0 END) as total_suelo,
                SUM(kilos) as total_general
            FROM registro_kilos
            WHERE campana_id = ? AND finca_id = ?
        """, (cid, finca_id)).fetchone()
        
        # Rendimientos medios (Media armónica)
        rendimientos = conn.execute("""
            SELECT 
                COUNT(CASE WHEN tipo = 'ARBOL' AND rendimiento > 0 THEN 1 END) / 
                SUM(CASE WHEN tipo = 'ARBOL' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END) as rend_arbol,
                
                COUNT(CASE WHEN tipo = 'SUELO' AND rendimiento > 0 THEN 1 END) / 
                SUM(CASE WHEN tipo = 'SUELO' AND rendimiento > 0 THEN 1.0 / rendimiento ELSE 0 END) as rend_suelo
            FROM registro_kilos
            WHERE campana_id = ? AND finca_id = ?
        """, (cid, finca_id)).fetchone()
        
        # Comprobar si la finca participó en esa campaña
        asignada = conn.execute("""
            SELECT 1 FROM campana_fincas WHERE campana_id = ? AND finca_id = ?
        """, (cid, finca_id)).fetchone() is not None
        
        # Mostramos la campaña si estuvo asignada o si tiene algún registro histórico de horas o de kilos
        if asignada or horas_sum > 0 or (kilos['total_general'] or 0) > 0:
            result.append({
                "campana_nombre": cname,
                "horas_totales": horas_sum,
                "kilos_total": kilos['total_general'] or 0,
                "kilos_arbol": kilos['total_arbol'] or 0,
                "kilos_suelo": kilos['total_suelo'] or 0,
                "rend_medio_arbol": rendimientos['rend_arbol'] or 0,
                "rend_medio_suelo": rendimientos['rend_suelo'] or 0
            })
            
    conn.close()
    return result

def obtener_analisis_trabajo(campana_id, trabajo):
    """Obtiene el resumen y desglose de horas para un tipo de trabajo concreto en una campaña."""
    conn = get_connection()
    # Horas totales de este trabajo
    horas_totales = conn.execute("""
        SELECT SUM(horas) FROM registro_horas 
        WHERE campana_id = ? AND trabajo = ?
    """, (campana_id, trabajo.strip().upper())).fetchone()[0] or 0
    
    # Desglose por finca
    desglose_finca = conn.execute("""
        SELECT f.nombre as finca, SUM(h.horas) as horas
        FROM registro_horas h
        JOIN fincas f ON h.finca_id = f.id
        WHERE h.campana_id = ? AND h.trabajo = ?
        GROUP BY f.nombre
        ORDER BY horas DESC
    """, (campana_id, trabajo.strip().upper())).fetchall()
    
    # Desglose por trabajador
    desglose_trabajador = conn.execute("""
        SELECT t.nombre as trabajador, SUM(h.horas) as horas
        FROM registro_horas h
        JOIN trabajadores t ON h.trabajador_id = t.id
        WHERE h.campana_id = ? AND h.trabajo = ?
        GROUP BY t.nombre
        ORDER BY horas DESC
    """, (campana_id, trabajo.strip().upper())).fetchall()
    
    conn.close()
    return {
        "trabajo": trabajo,
        "horas_totales": horas_totales,
        "desglose_finca": [dict(r) for r in desglose_finca],
        "desglose_trabajador": [dict(r) for r in desglose_trabajador]
    }

def consultar_catastro(provincia, municipio, poligono, parcela):
    """
    Realiza la consulta catastral de una parcela rústica.
    Devuelve un diccionario con: referencia_catastral, superficie_m2, localizacion, latitude, longitude
    O lanza una excepción con el error detallado.
    """
    prov_str = provincia.strip().upper()
    mun_str = municipio.strip().upper()
    pol_str = str(poligono).strip()
    par_str = str(parcela).strip()

    # 1. Consulta Datos No Protegidos por Polígono y Parcela (Consulta_DNPPP)
    url_dnp = "https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPPP"
    params_dnp = {
        "Provincia": prov_str,
        "Municipio": mun_str,
        "Poligono": pol_str,
        "Parcela": par_str
    }
    
    try:
        res_dnp = requests.get(url_dnp, params=params_dnp, timeout=12)
    except requests.exceptions.RequestException as e:
        raise Exception(f"Error de conexión con el Catastro: {str(e)}")

    if res_dnp.status_code != 200:
        raise Exception(f"El Catastro respondió con código de estado {res_dnp.status_code}")

    root_dnp = ET.fromstring(res_dnp.content)
    namespaces = {'cat': 'http://www.catastro.meh.es/'}

    # Verificar si hay error en la respuesta del Catastro
    err_elem = root_dnp.find('.//cat:lerr/cat:err/cat:des', namespaces)
    if err_elem is not None:
        raise Exception(err_elem.text)

    # Extraer Referencia Catastral (primera coincidencia)
    rc_elem = root_dnp.find('.//cat:rc', namespaces)
    if rc_elem is None:
        raise Exception("No se encontró la Referencia Catastral para esta finca.")

    pc1 = rc_elem.find('cat:pc1', namespaces).text if rc_elem.find('cat:pc1', namespaces) is not None else ""
    pc2 = rc_elem.find('cat:pc2', namespaces).text if rc_elem.find('cat:pc2', namespaces) is not None else ""
    car = rc_elem.find('cat:car', namespaces).text if rc_elem.find('cat:car', namespaces) is not None else "0000"
    cc1 = rc_elem.find('cat:cc1', namespaces).text if rc_elem.find('cat:cc1', namespaces) is not None else ""
    cc2 = rc_elem.find('cat:cc2', namespaces).text if rc_elem.find('cat:cc2', namespaces) is not None else ""
    
    # La referencia catastral completa de 20 posiciones
    ref_catastral = pc1 + pc2 + car + cc1 + cc2
    # La de 14 posiciones para buscar coordenadas
    ref_catastral_14 = pc1 + pc2

    # Extraer Paraje / Localización
    localizacion = ""
    ldt_elem = root_dnp.find('.//cat:ldt', namespaces)
    if ldt_elem is not None:
        localizacion = ldt_elem.text
    else:
        npa_elem = root_dnp.find('.//cat:npa', namespaces)
        localizacion = npa_elem.text if npa_elem is not None else f"Polígono {pol_str} Parcela {par_str}"

    # Calcular Superficie sumando todas las subparcelas (<ssp>)
    superficie_m2 = 0.0
    for ssp in root_dnp.findall('.//cat:ssp', namespaces):
        try:
            superficie_m2 += float(ssp.text)
        except (ValueError, TypeError):
            pass

    # 2. Consulta de Coordenadas (Consulta_CPMRC) usando los primeros 14 caracteres de la Ref. Catastral
    url_coor = "https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCoordenadas.asmx/Consulta_CPMRC"
    params_coor = {
        "Provincia": prov_str,
        "Municipio": mun_str,
        "SRS": "EPSG:4326",  # Coordenadas geográficas WGS84
        "RC": ref_catastral_14
    }

    latitude = None
    longitude = None

    try:
        res_coor = requests.get(url_coor, params=params_coor, timeout=12)
        if res_coor.status_code == 200:
            root_coor = ET.fromstring(res_coor.content)
            xcen_elem = root_coor.find('.//cat:coor/cat:getcoor/cat:x', namespaces)
            ycen_elem = root_coor.find('.//cat:coor/cat:getcoor/cat:y', namespaces)
            if xcen_elem is not None and ycen_elem is not None:
                longitude = float(xcen_elem.text)
                latitude = float(ycen_elem.text)
    except Exception as e:
        print(f"Error al obtener coordenadas catastrales: {e}")

    return {
        "provincia": prov_str,
        "municipio": mun_str,
        "poligono": int(pol_str),
        "parcela": int(par_str),
        "referencia_catastral": ref_catastral,
        "superficie_m2": superficie_m2,
        "localizacion": localizacion,
        "latitude": latitude,
        "longitude": longitude
    }

