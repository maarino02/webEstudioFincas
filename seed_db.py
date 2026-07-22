import pandas as pd
import sqlite3
import os
import database

EXCEL_PATH = "Cuadrante aceituna pa mi.xlsx"
DB_PATH = "aceituna.db"

def seed():
    if not os.path.exists(EXCEL_PATH):
        print(f"Error: No se encuentra el archivo Excel en {EXCEL_PATH}")
        return

    # Eliminar base de datos previa para garantizar un reinicio limpio del esquema
    if os.path.exists(DB_PATH):
        print("Eliminando base de datos antigua para aplicar el nuevo esquema multicampaña...")
        try:
            os.remove(DB_PATH)
        except Exception as e:
            print(f"No se pudo eliminar el archivo {DB_PATH}: {e}. Asegúrate de cerrar cualquier proceso que lo esté usando.")
            return

    print("Inicializando la nueva base de datos...")
    database.init_db()

    # 1. Crear campaña inicial y marcarla como activa
    print("Creando campaña por defecto '24/25'...")
    campana_id = database.add_campana("24/25")
    if not campana_id:
        print("Error: No se pudo crear la campaña 24/25.")
        return
    database.set_campana_activa(campana_id)

    # 2. Leer las pestañas del Excel para obtener las Fincas
    print("Leyendo fincas del Excel...")
    xl = pd.ExcelFile(EXCEL_PATH)
    fincas_excel = [sheet for sheet in xl.sheet_names if sheet.upper() != 'RESULTADOS FINALES']

    finca_ids = []
    for finca in fincas_excel:
        nombre_finca = finca.strip().upper()
        fid = database.add_finca_global(nombre_finca)
        if fid:
            finca_ids.append(fid)
            print(f"  Finca creada globalmente: {nombre_finca} (ID: {fid})")

    # 3. Leer la primera pestaña para obtener los Trabajadores (A4 a A12)
    print("Leyendo trabajadores del Excel...")
    primer_sheet = fincas_excel[0]
    df = pd.read_excel(EXCEL_PATH, sheet_name=primer_sheet, header=None)
    nombres_trabajadores = df.iloc[3:12, 0].tolist()

    trabajador_ids = []
    for nombre in nombres_trabajadores:
        if pd.notna(nombre) and str(nombre).strip():
            nombre_trabajador = str(nombre).strip().upper()
            tid = database.add_trabajador_global(nombre_trabajador)
            if tid:
                trabajador_ids.append(tid)
                print(f"  Trabajador creado globalmente: {nombre_trabajador} (ID: {tid})")

    # 4. Asociar todas las fincas e ingresores a la campaña "24/25"
    print("\nAsociando fincas y trabajadores a la Campaña '24/25'...")
    database.asignar_fincas_a_campana(campana_id, finca_ids)
    database.asignar_trabajadores_a_campana(campana_id, trabajador_ids)

    print("\n" + "="*50)
    print("PROCESO DE CARGA INICIAL MULTICAMPAÑA COMPLETADO")
    print(f"Campaña Activa: '24/25'")
    print(f"Fincas globales creadas y asignadas: {len(finca_ids)}")
    print(f"Trabajadores globales creados y asignados: {len(trabajador_ids)}")
    print("="*50)

if __name__ == "__main__":
    seed()
