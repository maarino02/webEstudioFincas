from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import database
import requests
import re

app = FastAPI(title="Cuadrante de Aceituna API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Modelos Pydantic
class HorasRequest(BaseModel):
    campana_id: int
    finca_id: int
    trabajador_id: int
    fecha: str  # YYYY-MM-DD
    horas: float
    trabajo: Optional[str] = 'RECOLECTA'

class EntregaRequest(BaseModel):
    campana_id: int
    finca_id: int
    fecha: str  # YYYY-MM-DD
    tipo: str   # 'ARBOL' o 'SUELO'
    kilos: float
    rendimiento: float

class IncidenciaRequest(BaseModel):
    campana_id: int
    finca_id: int
    fecha: str  # YYYY-MM-DD
    incidencias: str

class ParcelaBase(BaseModel):
    provincia: str
    municipio: str
    poligono: int
    parcela: int
    referencia_catastral: Optional[str] = None
    superficie_m2: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    localizacion: Optional[str] = None

class FincaRequest(BaseModel):
    nombre: str
    parcelas: Optional[List[ParcelaBase]] = None
    # Campos heredados por compatibilidad
    provincia: Optional[str] = None
    municipio: Optional[str] = None
    poligono: Optional[int] = None
    parcela: Optional[int] = None
    referencia_catastral: Optional[str] = None
    superficie_m2: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    localizacion: Optional[str] = None

class TrabajadorRequest(BaseModel):
    nombre: str

class CampanaRequest(BaseModel):
    nombre: str

class AsignacionRequest(BaseModel):
    finca_ids: List[int]
    trabajador_ids: List[int]

class FincaTrabajadoresRequest(BaseModel):
    trabajador_ids: List[int]

class TarifaRequest(BaseModel):
    tarifa_hora: float

class PrecioCampanaRequest(BaseModel):
    precio_aceituna_kg: float

class PagoRequest(BaseModel):
    campana_id: int
    trabajador_id: int
    fecha: str  # YYYY-MM-DD
    importe: float
    concepto: Optional[str] = ""

@app.on_event("startup")
def startup_db():
    database.init_db()

# --- ENDPOINTS DE CAMPAÑAS ---

@app.get("/api/campanas")
def read_campanas():
    return database.get_campanas()

@app.get("/api/campanas/activa")
def read_campana_activa():
    activa = database.get_campana_activa()
    if not activa:
        raise HTTPException(status_code=404, detail="No hay ninguna campaña creada.")
    return activa

@app.post("/api/campanas")
def create_campana(req: CampanaRequest):
    cid = database.add_campana(req.nombre)
    if not cid:
        raise HTTPException(status_code=400, detail="La campaña ya existe o el nombre no es válido.")
    return {"status": "ok", "campana_id": cid}

@app.post("/api/campanas/activa/{campana_id}")
def select_campana_activa(campana_id: int):
    database.set_campana_activa(campana_id)
    return {"status": "ok"}

# --- ENDPOINTS CATALOGO GLOBAL ---

@app.get("/api/global/fincas")
def read_global_fincas():
    return database.get_global_fincas()

@app.post("/api/global/fincas")
def create_global_finca(req: FincaRequest):
    parcelas = []
    if req.parcelas is not None:
        parcelas = [p.dict() for p in req.parcelas]
    elif req.poligono is not None and req.parcela is not None:
        parcelas = [{
            "provincia": req.provincia or "JAEN",
            "municipio": req.municipio or "ALCALA LA REAL",
            "poligono": req.poligono,
            "parcela": req.parcela,
            "referencia_catastral": req.referencia_catastral,
            "superficie_m2": req.superficie_m2,
            "latitude": req.latitude,
            "longitude": req.longitude,
            "localizacion": req.localizacion
        }]
        
    fid = database.add_finca_global(req.nombre, parcelas)
    if not fid:
        raise HTTPException(status_code=400, detail="La finca ya existe.")
    return {"status": "ok", "finca_id": fid}

@app.get("/api/global/trabajadores")
def read_global_trabajadores():
    return database.get_global_trabajadores()

@app.post("/api/global/trabajadores")
def create_global_trabajador(req: TrabajadorRequest):
    tid = database.add_trabajador_global(req.nombre)
    if not tid:
        raise HTTPException(status_code=400, detail="El trabajador ya existe.")
    return {"status": "ok", "trabajador_id": tid}

# --- ASIGNACIÓN DE FINCAS Y TRABAJADORES POR CAMPAÑA ---

@app.get("/api/fincas")
def read_fincas(campana_id: int = Query(..., description="ID de la campaña")):
    return database.get_campana_fincas(campana_id)

@app.get("/api/trabajadores")
def read_trabajadores(campana_id: int = Query(..., description="ID de la campaña")):
    return database.get_campana_trabajadores(campana_id)

@app.post("/api/campanas/{campana_id}/asignar")
def assign_to_campana(campana_id: int, req: AsignacionRequest):
    try:
        database.asignar_fincas_a_campana(campana_id, req.finca_ids)
        database.asignar_trabajadores_a_campana(campana_id, req.trabajador_ids)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- REGISTRO DIARIO Y CUADRANTES ---

@app.get("/api/cuadrante/{finca_id}")
def read_cuadrante(finca_id: int, campana_id: int = Query(..., description="ID de la campaña")):
    return database.obtener_cuadrante_finca(campana_id, finca_id)

@app.post("/api/registro/horas")
def save_horas(req: HorasRequest):
    try:
        database.guardar_horas(req.campana_id, req.finca_id, req.trabajador_id, req.fecha, req.horas, req.trabajo)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/registro/horas")
def read_horas(
    campana_id: int = Query(...),
    finca_id: int = Query(...),
    fecha: str = Query(...),
    trabajo: str = Query('RECOLECTA')
):
    try:
        return database.obtener_horas_dia(campana_id, finca_id, fecha, trabajo)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- ENDPOINTS ENTREGAS DE KILOS (NUEVOS) ---

@app.get("/api/registro/entregas")
def read_entregas(
    campana_id: int = Query(...), 
    finca_id: int = Query(...), 
    fecha: str = Query(...)
):
    return database.obtener_entregas_dia(campana_id, finca_id, fecha)

@app.post("/api/registro/entrega")
def add_entrega(req: EntregaRequest):
    try:
        eid = database.agregar_entrega(
            req.campana_id, req.finca_id, req.fecha, req.tipo, req.kilos, req.rendimiento
        )
        return {"status": "ok", "entrega_id": eid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/registro/entrega/{entrega_id}")
def delete_entrega(entrega_id: int):
    try:
        database.eliminar_entrega(entrega_id)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- ENDPOINTS INCIDENCIAS ---

@app.get("/api/registro/incidencias")
def read_incidencias(
    campana_id: int = Query(...), 
    finca_id: int = Query(...), 
    fecha: str = Query(...)
):
    text = database.obtener_incidencia_dia(campana_id, finca_id, fecha)
    return {"incidencias": text}

@app.post("/api/registro/incidencia")
def save_incidencia(req: IncidenciaRequest):
    try:
        database.guardar_incidencia(req.campana_id, req.finca_id, req.fecha, req.incidencias)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- REPORTES ---

@app.get("/api/resumen")
def get_resumen(campana_id: int = Query(..., description="ID de la campaña")):
    try:
        return database.obtener_resumen_general(campana_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/historial/campanas")
def get_historial_campanas():
    try:
        return database.obtener_historial_campanas()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/actividad")
def read_actividad(fecha: str = Query(...), campana_id: int = Query(...)):
    try:
        return database.obtener_fincas_con_actividad(campana_id, fecha)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- ASIGNACIÓN DE TRABAJADORES POR FINCA ---

@app.get("/api/campanas/{campana_id}/fincas/{finca_id}/trabajadores")
def read_finca_trabajadores(campana_id: int, finca_id: int):
    return database.obtener_trabajadores_finca(campana_id, finca_id)

@app.post("/api/campanas/{campana_id}/fincas/{finca_id}/trabajadores")
def assign_finca_trabajadores(campana_id: int, finca_id: int, req: FincaTrabajadoresRequest):
    try:
        database.asignar_trabajadores_a_finca(campana_id, finca_id, req.trabajador_ids)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- EDICIÓN Y BORRADO DE CATÁLOGO GLOBAL ---

@app.put("/api/global/fincas/{finca_id}")
def update_global_finca(finca_id: int, req: FincaRequest):
    parcelas = []
    if req.parcelas is not None:
        parcelas = [p.dict() for p in req.parcelas]
    elif req.poligono is not None and req.parcela is not None:
        parcelas = [{
            "provincia": req.provincia or "JAEN",
            "municipio": req.municipio or "ALCALA LA REAL",
            "poligono": req.poligono,
            "parcela": req.parcela,
            "referencia_catastral": req.referencia_catastral,
            "superficie_m2": req.superficie_m2,
            "latitude": req.latitude,
            "longitude": req.longitude,
            "localizacion": req.localizacion
        }]
        
    ok = database.editar_finca_global(finca_id, req.nombre, parcelas)
    if not ok:
        raise HTTPException(status_code=400, detail="El nombre ya existe o no es válido.")
    return {"status": "ok"}

@app.get("/api/catastro/buscar")
def search_catastro(
    provincia: str = Query(...),
    municipio: str = Query(...),
    poligono: int = Query(...),
    parcela: int = Query(...)
):
    try:
        return database.consultar_catastro(provincia, municipio, poligono, parcela)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/api/global/fincas/{finca_id}")
def delete_global_finca(finca_id: int):
    try:
        database.eliminar_finca_global(finca_id)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/global/trabajadores/{trabajador_id}")
def update_global_trabajador(trabajador_id: int, req: TrabajadorRequest):
    ok = database.editar_trabajador_global(trabajador_id, req.nombre)
    if not ok:
        raise HTTPException(status_code=400, detail="El nombre ya existe o no es válido.")
    return {"status": "ok"}

@app.delete("/api/global/trabajadores/{trabajador_id}")
def delete_global_trabajador(trabajador_id: int):
    try:
        database.eliminar_trabajador_global(trabajador_id)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- ANÁLISIS COMPARATIVO ---

@app.get("/api/comparativa/campanas")
def get_comparativa_campanas():
    try:
        return database.obtener_comparativa_campanas()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/comparativa/finca/{finca_id}")
def get_comparativa_finca(finca_id: int):
    try:
        return database.obtener_comparativa_finca(finca_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/trabajos/analisis")
def get_trabajos_analisis(
    campana_id: int = Query(...),
    trabajo: str = Query(...)
):
    try:
        return database.obtener_analisis_trabajo(campana_id, trabajo)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- ENDPOINTS CONTROL ECONÓMICO Y PAGOS ---

@app.put("/api/campanas/{campana_id}/precio")
def update_precio_campana(campana_id: int, req: PrecioCampanaRequest):
    try:
        database.actualizar_precio_aceituna(campana_id, req.precio_aceituna_kg)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.put("/api/campanas/{campana_id}/trabajadores/{trabajador_id}/tarifa")
def update_tarifa_trabajador(campana_id: int, trabajador_id: int, req: TarifaRequest):
    try:
        database.actualizar_tarifa_trabajador(campana_id, trabajador_id, req.tarifa_hora)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/pagos")
def read_pagos(campana_id: int = Query(...), trabajador_id: Optional[int] = None):
    try:
        return database.obtener_pagos_trabajadores(campana_id, trabajador_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/pagos")
def create_pago(req: PagoRequest):
    try:
        pago_id = database.guardar_pago_trabajador(req.campana_id, req.trabajador_id, req.fecha, req.importe, req.concepto)
        return {"status": "ok", "pago_id": pago_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/api/pagos/{pago_id}")
def delete_pago(pago_id: int):
    try:
        database.eliminar_pago_trabajador(pago_id)
        return {"status": "ok"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/resumen/saldos")
def read_resumen_saldos(campana_id: int = Query(...)):
    try:
        return database.obtener_resumen_saldos(campana_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/precios/aceite")
def get_live_oil_prices():
    url = "https://infaoliva.com/"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code == 200:
            html = r.text
            date_match = re.search(r'<p class="small"><strong>(.*?)</strong></p>', html)
            fecha = date_match.group(1) if date_match else "Desconocida"
            
            rows = re.findall(r'<tr>\s*<td>\s*<strong>(.*?)</strong>\s*</td>\s*<td align="center">(.*?)</td>\s*<td align="right"><strong>(.*?)</strong></td>\s*</tr>', html, re.DOTALL | re.IGNORECASE)
            
            result = []
            for row in rows:
                result.append({
                    "categoria": row[0].strip(),
                    "variedad": row[1].strip(),
                    "precio": row[2].strip()
                })
            return {"status": "ok", "fecha": fecha, "precios": result}
    except Exception as e:
        print("Error scraping Infaoliva:", e)
    return {"status": "error", "message": "No se pudieron obtener los precios en directo."}

# Servir frontend estático
app.mount("/", StaticFiles(directory="static", html=True), name="static")
