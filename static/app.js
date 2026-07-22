// --- REGISTRO DEL SERVICE WORKER PARA PWA ---
if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js")
            .then(reg => console.log("PWA: Service Worker registrado con éxito.", reg.scope))
            .catch(err => console.error("PWA: Error al registrar el Service Worker:", err));
    });
}

// --- VARIABLES DE ESTADO LOCAL ---
let campanas = [];
let campanaSeleccionadaId = null;

let fincasGlobales = [];
let trabajadoresGlobales = [];

let fincasCampana = [];
let trabajadoresCampana = [];

let activeTab = 'dashboard';
let mapaFinca = null;
let parcelasCreacionTemporales = [];
let parcelasEdicionTemporales = [];
let currentFincaId = null;
let currentFecha = "";

// --- CONFIGURACIÓN AL CARGAR LA PÁGINA ---
document.addEventListener("DOMContentLoaded", () => {
    // Establecer fecha por defecto (hoy)
    currentFecha = new Date().toISOString().split('T')[0];
    
    document.getElementById("fecha-input").value = currentFecha;
    document.getElementById("jornal-fecha-input").value = currentFecha;
    document.getElementById("peso-fecha-input").value = currentFecha;
    
    // Mostrar fecha en formato bonito en el dashboard
    const opcionesFecha = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById("dashboard-date-str").innerText = new Date().toLocaleDateString('es-ES', opcionesFecha);

    // Cargar listas iniciales
    inicializarApp();
});

async function inicializarApp() {
    // 1. Obtener la campaña activa del backend
    await cargarCampanas();
    
    if (campanaSeleccionadaId) {
        // 2. Cargar los catálogos globales
        await cargarCatalogosGlobales();
        
        // 3. Cargar las fincas y trabajadores de la campaña seleccionada
        await cargarFincasYTrabajadoresCampana();
        
        // 4. Cargar datos visuales
        await cargarResumenDashboard();
    }
}

// --- SINCRONIZACIÓN DE SELECCIÓN DE FINCA Y FECHA ---

function sincronizarSelectores(fincaId, fecha) {
    if (fincaId !== undefined && fincaId !== null) {
        currentFincaId = parseInt(fincaId);
        
        const fSelect = document.getElementById("finca-select");
        const jSelect = document.getElementById("jornal-finca-select");
        const pSelect = document.getElementById("peso-finca-select");
        const aSelect = document.getElementById("assign-finca-select");
        const cSelect = document.getElementById("comparacion-finca-select");
        
        if (fSelect) fSelect.value = currentFincaId;
        if (jSelect) jSelect.value = currentFincaId;
        if (pSelect) pSelect.value = currentFincaId;
        if (aSelect) aSelect.value = currentFincaId;
        if (cSelect) cSelect.value = currentFincaId;
    }
    
    if (fecha !== undefined && fecha !== "") {
        currentFecha = fecha;
        
        const fInput = document.getElementById("fecha-input");
        const jInput = document.getElementById("jornal-fecha-input");
        const pInput = document.getElementById("peso-fecha-input");
        
        if (fInput) fInput.value = currentFecha;
        if (jInput) jInput.value = currentFecha;
        if (pInput) pInput.value = currentFecha;
    }
}

// --- GESTIÓN DE CAMPAÑAS ---

async function cargarCampanas() {
    try {
        let res = await fetch('/api/campanas');
        campanas = await res.json();
        
        res = await fetch('/api/campanas/activa');
        if (res.ok) {
            const activa = await res.json();
            campanaSeleccionadaId = activa.id;
        } else if (campanas.length > 0) {
            campanaSeleccionadaId = campanas[0].id;
        }
        
        renderizarSelectorCampanas();
    } catch (e) {
        console.error("Error al cargar campañas:", e);
    }
}

function renderizarSelectorCampanas() {
    const select = document.getElementById("global-campaign-select");
    select.innerHTML = campanas.map(c => `
        <option value="${c.id}" ${c.id === campanaSeleccionadaId ? 'selected' : ''}>
            Campaña ${c.nombre}
        </option>
    `).join('');
}

async function cambiarCampanaActiva() {
    const select = document.getElementById("global-campaign-select");
    const id = parseInt(select.value);
    
    try {
        const res = await fetch(`/api/campanas/activa/${id}`, { method: 'POST' });
        if (res.ok) {
            campanaSeleccionadaId = id;
            
            // Re-inicializar datos de la nueva campaña
            await cargarCatalogosGlobales();
            await cargarFincasYTrabajadoresCampana();
            
            // Limpiar finca actual
            currentFincaId = null;
            
            // Ir a dashboard
            switchTab('dashboard');
        } else {
            alert("Error al cambiar de campaña.");
        }
    } catch (e) {
        console.error(e);
        alert("Error de conexión.");
    }
}

async function crearCampana(event) {
    event.preventDefault();
    const input = document.getElementById("nueva-campana-nombre");
    const nombre = input.value;
    
    try {
        const res = await fetch('/api/campanas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nombre })
        });
        
        if (res.ok) {
            input.value = "";
            alert("Campaña creada con éxito.");
            await cargarCampanas();
        } else {
            const err = await res.json();
            alert(`Error: ${err.detail}`);
        }
    } catch (e) {
        console.error(e);
        alert("Error al conectar con el servidor.");
    }
}

// --- EDICIÓN Y BORRADO DE CATÁLOGO GLOBAL ---

async function cargarCatalogosGlobales() {
    try {
        let res = await fetch('/api/global/fincas');
        fincasGlobales = await res.json();
        
        res = await fetch('/api/global/trabajadores');
        trabajadoresGlobales = await res.json();
        
        renderizarCatalogosListas();
        
        // Rellenar selector de finca en pestaña de comparación
        const compSelect = document.getElementById("comparacion-finca-select");
        if (compSelect) {
            compSelect.innerHTML = fincasGlobales.length === 0
                ? `<option value="">-- No hay fincas registradas --</option>`
                : fincasGlobales.map(f => `<option value="${f.id}">${f.nombre}</option>`).join('');
            if (currentFincaId) compSelect.value = currentFincaId;
        }
    } catch (e) {
        console.error("Error al cargar catálogos:", e);
    }
}

function renderizarCatalogosListas() {
    const fincasList = document.getElementById("catalog-fincas-list");
    const trabajadoresList = document.getElementById("catalog-trabajadores-list");
    
    if (fincasList) {
        if (fincasGlobales.length === 0) {
            fincasList.innerHTML = `<p style="color: var(--gray); font-style: italic;">No hay fincas registradas.</p>`;
        } else {
            fincasList.innerHTML = fincasGlobales.map(f => {
                let catastralInfo = "";
                if (f.parcelas && f.parcelas.length > 0) {
                    const totalArea = f.parcelas.reduce((acc, curr) => acc + (curr.superficie_m2 || 0), 0);
                    const totalHa = (totalArea / 10000).toFixed(2);
                    const parcelsText = f.parcelas.map(p => `Pol.${p.poligono} Parc.${p.parcela}`).join(', ');
                    catastralInfo = `<small style="display:block; color:var(--gray); margin-top:0.2rem; font-size:0.8rem;">📍 ${f.parcelas.length} parcelas (${totalHa} ha): <span style="font-style:italic;">${parcelsText}</span></small>`;
                } else if (f.poligono && f.parcela) {
                    catastralInfo = `<small style="display:block; color:var(--gray); margin-top:0.2rem; font-size:0.8rem;">📍 Pol. ${f.poligono} Parc. ${f.parcela} ${f.superficie_m2 ? `(${(f.superficie_m2/10000).toFixed(2)} ha)` : ''}</small>`;
                }
                return `
                    <div class="catalog-item" style="flex-direction: column; align-items: flex-start; gap: 0.2rem; padding: 0.75rem 1rem;">
                        <div style="display: flex; justify-content: space-between; width: 100%; align-items: center;">
                            <span>🚜 <strong>${f.nombre}</strong></span>
                            <div class="catalog-item-actions">
                                <button class="action-icon-btn" onclick="abrirModalEditarFinca(${f.id})" title="Editar Finca">✏️</button>
                                <button class="action-icon-btn delete-icon" onclick="eliminarFincaGlobal(${f.id}, '${f.nombre}')" title="Eliminar Finca de Raíz">🗑️</button>
                            </div>
                        </div>
                        ${catastralInfo}
                    </div>
                `;
            }).join('');
        }
    }
    
    if (trabajadoresList) {
        if (trabajadoresGlobales.length === 0) {
            trabajadoresList.innerHTML = `<p style="color: var(--gray); font-style: italic;">No hay trabajadores registrados.</p>`;
        } else {
            trabajadoresList.innerHTML = trabajadoresGlobales.map(t => `
                <div class="catalog-item">
                    <span>👤 ${t.nombre}</span>
                    <div class="catalog-item-actions">
                        <button class="action-icon-btn" onclick="editarTrabajadorGlobal(${t.id}, '${t.nombre}')" title="Editar Trabajador">✏️</button>
                        <button class="action-icon-btn delete-icon" onclick="eliminarTrabajadorGlobal(${t.id}, '${t.nombre}')" title="Eliminar Trabajador de Raíz">🗑️</button>
                    </div>
                </div>
            `).join('');
        }
    }
}

function renderizarParcelasCreacion() {
    const listDiv = document.getElementById("nueva-finca-parcelas-list");
    if (!listDiv) return;
    
    if (parcelasCreacionTemporales.length === 0) {
        listDiv.innerHTML = `<span style="font-size:0.85rem; color:var(--gray); font-style:italic;">No hay parcelas añadidas todavía.</span>`;
        return;
    }
    
    listDiv.innerHTML = parcelasCreacionTemporales.map((p, idx) => {
        const ha = p.superficie_m2 ? `${(p.superficie_m2/10000).toFixed(2)} ha` : 'No disponible';
        return `
            <div class="catalog-item" style="padding: 0.4rem 0.8rem; background-color: var(--light); border: 1px solid var(--primary-light); border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; margin: 0; width: 100%; box-sizing: border-box;">
                <span>📍 <strong>Pol. ${p.poligono} Parc. ${p.parcela}</strong> - ${p.localizacion || ''} (${ha})</span>
                <span onclick="eliminarParcelaCreacion(${idx})" style="color: var(--red); cursor: pointer; font-weight: bold; font-size: 1.2rem; line-height: 1; padding: 0 0.2rem;">&times;</span>
            </div>
        `;
    }).join('');
}

async function buscarYAgregarParcelaCreacion() {
    const pol = document.getElementById("nueva-finca-poligono").value;
    const par = document.getElementById("nueva-finca-parcela").value;
    const mun = document.getElementById("nueva-finca-municipio").value;
    const prov = document.getElementById("nueva-finca-provincia").value;
    
    if (!pol || !par || !mun || !prov) {
        alert("Por favor, rellena Polígono, Parcela, Municipio y Provincia.");
        return;
    }
    
    const exists = parcelasCreacionTemporales.some(p => p.poligono === parseInt(pol) && p.parcela === parseInt(par) && p.municipio.toUpperCase() === mun.toUpperCase());
    if (exists) {
        alert("Esta parcela ya ha sido añadida a la lista.");
        return;
    }
    
    try {
        const res = await fetch(`/api/catastro/buscar?provincia=${encodeURIComponent(prov)}&municipio=${encodeURIComponent(mun)}&poligono=${pol}&parcela=${par}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "No encontrado en el Catastro.");
        }
        
        const data = await res.json();
        parcelasCreacionTemporales.push(data);
        renderizarParcelasCreacion();
        
        document.getElementById("nueva-finca-poligono").value = "";
        document.getElementById("nueva-finca-parcela").value = "";
    } catch (e) {
        alert(`Error al buscar en el Catastro: ${e.message}`);
    }
}

function eliminarParcelaCreacion(index) {
    parcelasCreacionTemporales.splice(index, 1);
    renderizarParcelasCreacion();
}

async function crearFincaGlobal(event) {
    event.preventDefault();
    const input = document.getElementById("nueva-finca-nombre");
    const nombre = input.value.trim().toUpperCase();
    
    if (parcelasCreacionTemporales.length === 0) {
        // Validar si el usuario rellenó los campos individuales y olvidó pulsar "Añadir Parcela"
        const pol = document.getElementById("nueva-finca-poligono").value;
        const par = document.getElementById("nueva-finca-parcela").value;
        if (pol && par) {
            const conf = confirm("Tienes datos en los campos de parcela pero no los has añadido a la lista. ¿Quieres intentar buscar y añadir esa parcela automáticamente antes de guardar?");
            if (conf) {
                await buscarYAgregarParcelaCreacion();
                if (parcelasCreacionTemporales.length === 0) return; // Si falla, frenamos
            }
        } else {
            alert("Debes añadir al menos una parcela catastral para registrar la finca.");
            return;
        }
    }
    
    const body = {
        nombre: nombre,
        parcelas: parcelasCreacionTemporales
    };
    
    try {
        const res = await fetch('/api/global/fincas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (res.ok) {
            input.value = "";
            document.getElementById("nueva-finca-poligono").value = "";
            document.getElementById("nueva-finca-parcela").value = "";
            document.getElementById("nueva-finca-municipio").value = "ALCALA LA REAL";
            document.getElementById("nueva-finca-provincia").value = "JAEN";
            parcelasCreacionTemporales = [];
            renderizarParcelasCreacion();
            
            await cargarCatalogosGlobales();
            await renderizarListasAsignacion();
        } else {
            alert("Error al registrar finca. Tal vez ya existe.");
        }
    } catch (e) {
        console.error(e);
    }
}

async function crearTrabajadorGlobal(event) {
    event.preventDefault();
    const input = document.getElementById("nuevo-trabajador-nombre");
    const nombre = input.value;
    
    try {
        const res = await fetch('/api/global/trabajadores', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nombre })
        });
        
        if (res.ok) {
            input.value = "";
            await cargarCatalogosGlobales();
            await renderizarListasAsignacion();
        } else {
            alert("Error al registrar trabajador. Tal vez ya existe.");
        }
    } catch (e) {
        console.error(e);
    }
}

function renderizarParcelasEdicion() {
    const listDiv = document.getElementById("edit-finca-parcelas-list");
    if (!listDiv) return;
    
    if (parcelasEdicionTemporales.length === 0) {
        listDiv.innerHTML = `<span style="font-size:0.85rem; color:var(--gray); font-style:italic;">No hay parcelas añadidas todavía.</span>`;
        return;
    }
    
    listDiv.innerHTML = parcelasEdicionTemporales.map((p, idx) => {
        const ha = p.superficie_m2 ? `${(p.superficie_m2/10000).toFixed(2)} ha` : 'No disponible';
        return `
            <div class="catalog-item" style="padding: 0.4rem 0.8rem; background-color: var(--light); border: 1px solid var(--primary-light); border-radius: 6px; display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; margin: 0; width: 100%; box-sizing: border-box;">
                <span>📍 <strong>Pol. ${p.poligono} Parc. ${p.parcela}</strong> - ${p.localizacion || ''} (${ha})</span>
                <span onclick="eliminarParcelaEdicion(${idx})" style="color: var(--red); cursor: pointer; font-weight: bold; font-size: 1.2rem; line-height: 1; padding: 0 0.2rem;">&times;</span>
            </div>
        `;
    }).join('');
}

async function buscarYAgregarParcelaEdicion() {
    const pol = document.getElementById("edit-finca-poligono").value;
    const par = document.getElementById("edit-finca-parcela").value;
    const mun = document.getElementById("edit-finca-municipio").value;
    const prov = document.getElementById("edit-finca-provincia").value;
    
    if (!pol || !par || !mun || !prov) {
        alert("Por favor, rellena Polígono, Parcela, Municipio y Provincia.");
        return;
    }
    
    const exists = parcelasEdicionTemporales.some(p => p.poligono === parseInt(pol) && p.parcela === parseInt(par) && p.municipio.toUpperCase() === mun.toUpperCase());
    if (exists) {
        alert("Esta parcela ya ha sido añadida a la lista.");
        return;
    }
    
    try {
        const res = await fetch(`/api/catastro/buscar?provincia=${encodeURIComponent(prov)}&municipio=${encodeURIComponent(mun)}&poligono=${pol}&parcela=${par}`);
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || "No encontrado en el Catastro.");
        }
        
        const data = await res.json();
        parcelasEdicionTemporales.push(data);
        renderizarParcelasEdicion();
        
        document.getElementById("edit-finca-poligono").value = "";
        document.getElementById("edit-finca-parcela").value = "";
    } catch (e) {
        alert(`Error al buscar en el Catastro: ${e.message}`);
    }
}

function eliminarParcelaEdicion(index) {
    parcelasEdicionTemporales.splice(index, 1);
    renderizarParcelasEdicion();
}

function abrirModalEditarFinca(id) {
    const finca = fincasGlobales.find(f => f.id === id);
    if (!finca) return;
    
    document.getElementById("edit-finca-id").value = finca.id;
    document.getElementById("edit-finca-nombre").value = finca.nombre;
    
    // Rellenar campos de búsqueda por defecto
    document.getElementById("edit-finca-poligono").value = "";
    document.getElementById("edit-finca-parcela").value = "";
    document.getElementById("edit-finca-municipio").value = "ALCALA LA REAL";
    document.getElementById("edit-finca-provincia").value = "JAEN";
    
    // Clonar parcelas existentes
    parcelasEdicionTemporales = finca.parcelas ? JSON.parse(JSON.stringify(finca.parcelas)) : [];
    
    // Si no tiene parcelas de tabla finca_parcelas pero sí tenía campos antiguos de compatibilidad, los cargamos
    if (parcelasEdicionTemporales.length === 0 && finca.poligono && finca.parcela) {
        parcelasEdicionTemporales.push({
            provincia: finca.provincia || "JAEN",
            municipio: finca.municipio || "ALCALA LA REAL",
            poligono: finca.poligono,
            parcela: finca.parcela,
            referencia_catastral: finca.referencia_catastral,
            superficie_m2: finca.superficie_m2,
            latitude: finca.latitude,
            longitude: finca.longitude,
            localizacion: finca.localizacion
        });
    }
    
    renderizarParcelasEdicion();
    document.getElementById("modal-editar-finca").style.display = "flex";
}

function cerrarModalEditarFinca() {
    document.getElementById("modal-editar-finca").style.display = "none";
}

async function guardarEdicionFinca(event) {
    event.preventDefault();
    const id = document.getElementById("edit-finca-id").value;
    const nombre = document.getElementById("edit-finca-nombre").value.trim().toUpperCase();
    
    if (parcelasEdicionTemporales.length === 0) {
        const pol = document.getElementById("edit-finca-poligono").value;
        const par = document.getElementById("edit-finca-parcela").value;
        if (pol && par) {
            const conf = confirm("Tienes datos en los campos de parcela pero no los has añadido a la lista. ¿Quieres intentar buscar y añadir esa parcela automáticamente antes de guardar?");
            if (conf) {
                await buscarYAgregarParcelaEdicion();
                if (parcelasEdicionTemporales.length === 0) return;
            }
        } else {
            alert("Debes tener al menos una parcela vinculada a la finca.");
            return;
        }
    }
    
    const body = {
        nombre: nombre,
        parcelas: parcelasEdicionTemporales
    };
    
    try {
        const res = await fetch(`/api/global/fincas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (res.ok) {
            cerrarModalEditarFinca();
            alert("Finca editada con éxito.");
            await cargarCatalogosGlobales();
            await cargarFincasYTrabajadoresCampana();
        } else {
            alert("Error al editar finca.");
        }
    } catch (e) {
        console.error(e);
    }
}

async function eliminarFincaGlobal(id, nombre) {
    const conf = confirm(`¿SEGURIDAD: Seguro que quieres eliminar definitivamente la finca "${nombre}"?\n\n¡ATENCIÓN! Esto borrará todas las pesadas, notas de campo y jornales asociados a esta finca en TODAS las campañas de forma irrecuperable.`);
    if (!conf) return;
    
    try {
        const res = await fetch(`/api/global/fincas/${id}`, { method: 'DELETE' });
        if (res.ok) {
            alert("Finca eliminada de raíz.");
            await cargarCatalogosGlobales();
            await cargarFincasYTrabajadoresCampana();
            if (currentFincaId === id) currentFincaId = null;
            await cargarResumenDashboard();
        } else {
            alert("Error al eliminar finca.");
        }
    } catch (e) {
        console.error(e);
    }
}

async function editarTrabajadorGlobal(id, nombreActual) {
    const nuevoNombre = prompt("Editar nombre del trabajador:", nombreActual);
    if (!nuevoNombre || nuevoNombre.trim() === "" || nuevoNombre.trim().toUpperCase() === nombreActual) return;
    
    try {
        const res = await fetch(`/api/global/trabajadores/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre: nuevoNombre.trim() })
        });
        
        if (res.ok) {
            alert("Trabajador editado con éxito.");
            await cargarCatalogosGlobales();
            await cargarFincasYTrabajadoresCampana();
        } else {
            alert("Error al editar trabajador.");
        }
    } catch (e) {
        console.error(e);
    }
}

async function eliminarTrabajadorGlobal(id, nombre) {
    const conf = confirm(`¿SEGURIDAD: Seguro que quieres eliminar definitivamente a "${nombre}"?\n\n¡ATENCIÓN! Esto borrará todos los jornales, días y horas de trabajo registrados para esta persona en TODAS las campañas de forma irrecuperable.`);
    if (!conf) return;
    
    try {
        const res = await fetch(`/api/global/trabajadores/${id}`, { method: 'DELETE' });
        if (res.ok) {
            alert("Trabajador eliminado de raíz.");
            await cargarCatalogosGlobales();
            await cargarFincasYTrabajadoresCampana();
            await cargarResumenDashboard();
        } else {
            alert("Error al eliminar trabajador.");
        }
    } catch (e) {
        console.error(e);
    }
}

// --- ASIGNACIONES A CAMPAÑA ---

async function cargarFincasYTrabajadoresCampana() {
    if (!campanaSeleccionadaId) return;
    
    try {
        let res = await fetch(`/api/fincas?campana_id=${campanaSeleccionadaId}`);
        fincasCampana = await res.json();
        
        res = await fetch(`/api/trabajadores?campana_id=${campanaSeleccionadaId}`);
        trabajadoresCampana = await res.json();
        
        // Rellenar todos los dropdowns de finca en las distintas pestañas
        llenarDropdownsFinca();
        
        // Si no hay finca seleccionada pero la campaña tiene fincas, preseleccionar la primera
        if (!currentFincaId && fincasCampana.length > 0) {
            currentFincaId = fincasCampana[0].id;
        }
        
        sincronizarSelectores(currentFincaId, currentFecha);
        configurarCabecerasTablaHistorial();
        
    } catch (e) {
        console.error("Error al cargar fincas/trabajadores de campaña:", e);
    }
}

function llenarDropdownsFinca() {
    const fSelect = document.getElementById("finca-select");
    const jSelect = document.getElementById("jornal-finca-select");
    const pSelect = document.getElementById("peso-finca-select");
    const aSelect = document.getElementById("assign-finca-select");
    
    const opcionesHTML = fincasCampana.length === 0 
        ? `<option value="">-- No hay fincas asignadas --</option>`
        : fincasCampana.map(f => `<option value="${f.id}">${f.nombre}</option>`).join('');
        
    if (fSelect) fSelect.innerHTML = opcionesHTML;
    if (jSelect) jSelect.innerHTML = opcionesHTML;
    if (pSelect) pSelect.innerHTML = opcionesHTML;
    
    // El dropdown de asignación en Ajustes
    if (aSelect) aSelect.innerHTML = opcionesHTML;
}

function renderizarListasAsignacion() {
    const fincasChecklist = document.getElementById("assign-fincas-list");
    const trabajadoresChecklist = document.getElementById("assign-trabajadores-list");
    
    if (fincasChecklist) {
        fincasChecklist.innerHTML = fincasGlobales.map(f => {
            const estaAsignada = fincasCampana.some(fc => fc.id === f.id);
            return `
                <label class="checkbox-item">
                    <input type="checkbox" name="fincas-campana" value="${f.id}" ${estaAsignada ? 'checked' : ''}>
                    ${f.nombre}
                </label>
            `;
        }).join('');
    }
    
    if (trabajadoresChecklist) {
        trabajadoresChecklist.innerHTML = trabajadoresGlobales.map(t => {
            const estaAsignado = trabajadoresCampana.some(tc => tc.id === t.id);
            return `
                <label class="checkbox-item">
                    <input type="checkbox" name="trabajadores-campana" value="${t.id}" ${estaAsignado ? 'checked' : ''}>
                    ${t.nombre}
                </label>
            `;
        }).join('');
    }
}

async function guardarAsignacionesCampana(event) {
    event.preventDefault();
    if (!campanaSeleccionadaId) return;
    
    const checkedFincas = Array.from(document.querySelectorAll('input[name="fincas-campana"]:checked')).map(el => parseInt(el.value));
    const checkedTrabajadores = Array.from(document.querySelectorAll('input[name="trabajadores-campana"]:checked')).map(el => parseInt(el.value));
    
    try {
        const res = await fetch(`/api/campanas/${campanaSeleccionadaId}/asignar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                finca_ids: checkedFincas,
                trabajador_ids: checkedTrabajadores
            })
        });
        
        if (res.ok) {
            alert("Configuración de campaña guardada.");
            await cargarFincasYTrabajadoresCampana();
            await renderizarListasAsignacion();
            await cargarAsignacionTrabajadoresFinca();
        } else {
            alert("Error al guardar asignaciones.");
        }
    } catch (e) {
        console.error(e);
    }
}

// --- ASIGNACIÓN DE TRABAJADORES A FINCAS ---

async function cargarAsignacionTrabajadoresFinca() {
    if (!campanaSeleccionadaId) return;
    
    const select = document.getElementById("assign-finca-select");
    if (!select) return;
    const fincaId = parseInt(select.value);
    
    const container = document.getElementById("assign-finca-workers-list");
    if (!container) return;
    
    if (!fincaId) {
        container.innerHTML = `<p style="color: var(--gray); font-style: italic;">Selecciona una finca arriba para asignarle trabajadores.</p>`;
        return;
    }
    
    try {
        // Obtener los trabajadores ya asignados a esta finca en esta campaña
        const res = await fetch(`/api/campanas/${campanaSeleccionadaId}/fincas/${fincaId}/trabajadores`);
        const asignados = await res.json();
        
        if (trabajadoresCampana.length === 0) {
            container.innerHTML = `<p style="color: var(--gray); font-style: italic;">No hay trabajadores asignados a esta campaña. Asigna trabajadores primero.</p>`;
            return;
        }
        
        container.innerHTML = trabajadoresCampana.map(t => {
            const estaAsignado = asignados.some(tc => tc.id === t.id);
            return `
                <label class="checkbox-item">
                    <input type="checkbox" name="trabajadores-finca" value="${t.id}" ${estaAsignado ? 'checked' : ''}>
                    ${t.nombre}
                </label>
            `;
        }).join('');
    } catch (e) {
        console.error("Error al cargar trabajadores asignados a la finca:", e);
    }
}

async function guardarAsignacionTrabajadoresFinca(event) {
    event.preventDefault();
    if (!campanaSeleccionadaId) return;
    
    const select = document.getElementById("assign-finca-select");
    const fincaId = parseInt(select.value);
    if (!fincaId) return;
    
    const checkedTrabajadores = Array.from(document.querySelectorAll('input[name="trabajadores-finca"]:checked')).map(el => parseInt(el.value));
    
    try {
        const res = await fetch(`/api/campanas/${campanaSeleccionadaId}/fincas/${fincaId}/trabajadores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                trabajador_ids: checkedTrabajadores
            })
        });
        
        if (res.ok) {
            alert("Asignación de cuadrilla guardada con éxito.");
            await cargarAsignacionTrabajadoresFinca();
        } else {
            alert("Error al guardar la asignación.");
        }
    } catch (e) {
        console.error(e);
    }
}

// --- PANEL GENERAL (DASHBOARD) ---

async function cargarResumenDashboard() {
    if (!campanaSeleccionadaId) return;
    
    try {
        const res = await fetch(`/api/resumen?campana_id=${campanaSeleccionadaId}`);
        const data = await res.json();
        
        document.getElementById("dash-kilos-totales").innerText = `${data.kilos.total_general.toLocaleString('es-ES')} Kg`;
        document.getElementById("dash-kilos-arbol").innerText = `${data.kilos.total_arbol.toLocaleString('es-ES')} Kg`;
        document.getElementById("dash-kilos-suelo").innerText = `${data.kilos.total_suelo.toLocaleString('es-ES')} Kg`;
        
        const rendArbol = data.rendimientos.rend_medio_arbol ? data.rendimientos.rend_medio_arbol.toFixed(2) : '0';
        const rendSuelo = data.rendimientos.rend_medio_suelo ? data.rendimientos.rend_medio_suelo.toFixed(2) : '0';
        
        document.getElementById("dash-rend-arbol").innerText = `Rend. Medio: ${rendArbol}%`;
        document.getElementById("dash-rend-suelo").innerText = `Rend. Medio: ${rendSuelo}%`;
    } catch (e) {
        console.error("Error al cargar resumen dashboard:", e);
    }
}

// --- GESTIÓN DE PESTAÑAS (TABS) ---

function switchTab(tabId) {
    activeTab = tabId;
    
    document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
    const activeBtn = document.getElementById(`btn-${tabId}`);
    if (activeBtn) activeBtn.classList.add("active");
    
    document.querySelectorAll(".tab-content").forEach(tab => {
        tab.classList.remove("active");
        tab.style.display = "none";
        tab.style.opacity = "0";
    });
    const activeSection = document.getElementById(`tab-${tabId}`);
    if (activeSection) {
        activeSection.classList.add("active");
        activeSection.style.display = "flex";
        setTimeout(() => activeSection.style.opacity = "1", 50);
    }
    
    sincronizarSelectores(currentFincaId, currentFecha);
    
    if (tabId === 'dashboard') {
        cargarResumenDashboard();
    } else if (tabId === 'fincas') {
        cargarDatosFinca();
    } else if (tabId === 'jornal') {
        cargarJornalDia();
    } else if (tabId === 'peso') {
        cargarPesoDia();
    } else if (tabId === 'resumen') {
        cargarResumenConsolidado();
    } else if (tabId === 'historial') {
        cargarHistorialCampanas();
    } else if (tabId === 'comparacion') {
        cargarComparativaGeneral();
        cargarComparativaFinca();
    } else if (tabId === 'trabajos') {
        cargarAnalisisTrabajoActivo();
    } else if (tabId === 'config') {
        renderizarListasAsignacion();
        renderizarCatalogosListas();
        cargarAsignacionTrabajadoresFinca();
    }
}

async function alCambiarFecha() {
    const fecha = document.getElementById("fecha-input").value;
    if (!fecha || !campanaSeleccionadaId) return;
    
    try {
        const res = await fetch(`/api/actividad?fecha=${fecha}&campana_id=${campanaSeleccionadaId}`);
        const fincaIds = await res.json();
        
        if (fincaIds.length > 0) {
            // Si la finca actual no tiene actividad pero hay alguna que sí, seleccionamos automáticamente la primera con registros
            if (!fincaIds.includes(currentFincaId)) {
                sincronizarSelectores(fincaIds[0], fecha);
            } else {
                sincronizarSelectores(currentFincaId, fecha);
            }
        } else {
            sincronizarSelectores(currentFincaId, fecha);
        }
    } catch (e) {
        console.error("Error al comprobar actividad en la fecha:", e);
    }
    
    cargarDatosFinca();
}

function configurarCabecerasTablaHistorial() {
    const headersRow = document.getElementById("tabla-cuadrante-headers");
    if (!headersRow) return;
    headersRow.querySelectorAll(".worker-header").forEach(el => el.remove());
    
    trabajadoresCampana.forEach(t => {
        const th = document.createElement("th");
        th.className = "worker-header";
        th.innerText = t.nombre;
        headersRow.appendChild(th);
    });
}

// --- TAB 2: CONSULTA FINCAS (SOLO LECTURA) ---

async function cargarDatosFinca() {
    if (!campanaSeleccionadaId) return;
    
    const select = document.getElementById("finca-select");
    const id = parseInt(select.value);
    
    if (!id) {
        document.getElementById("tabla-cuadrante-body").innerHTML = `<tr><td colspan="${6 + trabajadoresCampana.length}" style="text-align: center; color: var(--gray)">No hay finca seleccionada.</td></tr>`;
        document.getElementById("consulta-resumen-dia").innerHTML = `<p style="color: var(--gray); font-style: italic;">Selecciona una finca arriba.</p>`;
        return;
    }
    
    sincronizarSelectores(id, currentFecha);
    
    try {
        // 1. Cargar las entregas del día
        const resEntregas = await fetch(`/api/registro/entregas?campana_id=${campanaSeleccionadaId}&finca_id=${currentFincaId}&fecha=${currentFecha}`);
        const entregas = await resEntregas.json();
        
        // 2. Cargar las incidencias del día
        const resInc = await fetch(`/api/registro/incidencias?campana_id=${campanaSeleccionadaId}&finca_id=${currentFincaId}&fecha=${currentFecha}`);
        const incData = await resInc.json();
        
        // 3. Cargar el cuadrante histórico
        const resCuadrante = await fetch(`/api/cuadrante/${currentFincaId}?campana_id=${campanaSeleccionadaId}`);
        const cuadrante = await resCuadrante.json();
        
        // 4. Buscar y consolidar datos del día
        const datosDia = cuadrante.find(c => c.fecha === currentFecha);
        
        // Rellenar resumen de la jornada
        const resumenDiv = document.getElementById("consulta-resumen-dia");
        if (datosDia || entregas.length > 0) {
            let html = `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 1.5rem;">`;
            
            // Sección entregas
            const totKilosArbol = entregas.filter(e => e.tipo === 'ARBOL').reduce((acc, curr) => acc + curr.kilos, 0);
            const totKilosSuelo = entregas.filter(e => e.tipo === 'SUELO').reduce((acc, curr) => acc + curr.kilos, 0);
            
            html += `
                <div>
                    <h4 style="color: var(--primary); margin-bottom: 0.5rem;">⚖️ Entregas de Kilos:</h4>
                    <ul style="list-style: none; padding: 0;">
                        <li>🌲 <strong>Árbol:</strong> ${totKilosArbol.toLocaleString('es-ES')} Kg ${datosDia && datosDia.rendimiento_arbol > 0 ? `(Rend. Medio: ${datosDia.rendimiento_arbol.toFixed(2)}%)` : ''}</li>
                        <li>🍂 <strong>Suelo:</strong> ${totKilosSuelo.toLocaleString('es-ES')} Kg ${datosDia && datosDia.rendimiento_suelo > 0 ? `(Rend. Medio: ${datosDia.rendimiento_suelo.toFixed(2)}%)` : ''}</li>
                        <li style="border-top: 1px solid var(--border); padding-top: 0.25rem; margin-top: 0.25rem;"><strong>Total:</strong> ${(totKilosArbol + totKilosSuelo).toLocaleString('es-ES')} Kg</li>
                    </ul>
                </div>
            `;
            
            // Sección trabajadores
            let trabaListHTML = "";
            if (datosDia) {
                const trabaTrabajando = trabajadoresCampana.filter(t => (datosDia.horas[t.id] || 0) > 0);
                if (trabaTrabajando.length > 0) {
                    trabaListHTML = trabaTrabajando.map(t => `<li>👤 ${t.nombre}: <strong>${datosDia.horas[t.id]} h</strong></li>`).join('');
                } else {
                    trabaListHTML = `<li><span style="color: var(--gray);">Sin horas de personal guardadas.</span></li>`;
                }
            } else {
                trabaListHTML = `<li><span style="color: var(--gray);">Sin horas de personal guardadas.</span></li>`;
            }
            
            html += `
                <div>
                    <h4 style="color: var(--primary); margin-bottom: 0.5rem;">⏱️ Personal en Finca:</h4>
                    <ul style="list-style: none; padding: 0;">
                        ${trabaListHTML}
                    </ul>
                </div>
            `;
            
            html += `</div>`;
            
            // Incidencias
            html += `
                <div style="background-color: var(--primary-bg); border-left: 4px solid var(--primary); padding: 0.75rem 1rem; border-radius: var(--radius-sm);">
                    <strong>📝 Notas/Incidencias:</strong> 
                    <p style="margin: 0.25rem 0 0 0; font-size: 0.95rem; line-height: 1.4;">${incData.incidencias || '<span style="color: var(--gray); font-style: italic;">Sin incidencias registradas.</span>'}</p>
                </div>
            `;
            
            resumenDiv.innerHTML = html;
        } else {
            resumenDiv.innerHTML = `<p style="color: var(--gray); font-style: italic; text-align: center; margin: 1.5rem 0;">No se registraron entregas, notas ni jornales en esta fecha para esta finca.</p>`;
        }
        
        // 5. Renderizar la tabla de historial consolidado
        renderizarHistorialFinca(cuadrante);
        
        // 6. Cargar visor de mapa catastral
        cargarMapaCatastralFinca();
        
    } catch (e) {
        console.error("Error al cargar cuadrante finca:", e);
    }
}

function renderizarHistorialFinca(cuadrante) {
    const tbody = document.getElementById("tabla-cuadrante-body");
    if (!tbody) return;
    
    if (cuadrante.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${6 + trabajadoresCampana.length}" style="text-align: center; color: var(--gray)">No hay registros guardados en esta finca para esta campaña.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = cuadrante.map(row => {
        const celdasHoras = trabajadoresCampana.map(t => {
            const h = row.horas[t.id] || 0;
            return `<td>${h > 0 ? `<strong>${h}h</strong>` : '-'}</td>`;
        }).join('');
        
        const fechaObj = new Date(row.fecha + 'T00:00:00');
        const fechaFormato = fechaObj.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
        
        return `
            <tr>
                <td><strong>${fechaFormato}</strong></td>
                <td>${row.kilos_arbol > 0 ? `${row.kilos_arbol.toLocaleString('es-ES')} Kg` : '-'}</td>
                <td>${row.rendimiento_arbol > 0 ? `${row.rendimiento_arbol.toFixed(2)}%` : '-'}</td>
                <td>${row.kilos_suelo > 0 ? `${row.kilos_suelo.toLocaleString('es-ES')} Kg` : '-'}</td>
                <td>${row.rendimiento_suelo > 0 ? `${row.rendimiento_suelo.toFixed(2)}%` : '-'}</td>
                <td><small>${row.incidencias || '-'}</small></td>
                ${celdasHoras}
            </tr>
        `;
    }).join('');
}

// --- TAB 3: AÑADIR JORNAL (HORAS DE TRABAJO) ---

let trabajadoresFincaActivos = [];

async function cargarJornalDia() {
    if (!campanaSeleccionadaId) return;
    
    const select = document.getElementById("jornal-finca-select");
    const id = parseInt(select.value);
    const fecha = document.getElementById("jornal-fecha-input").value;
    
    if (!id) {
        document.getElementById("jornal-workers-list-inputs").innerHTML = `<p style="color: var(--gray); font-style: italic; text-align: center;">Por favor, selecciona una finca.</p>`;
        return;
    }
    
    sincronizarSelectores(id, fecha);
    
    try {
        // 1. Obtener la lista de trabajadores asignados a esta finca
        const resTrab = await fetch(`/api/campanas/${campanaSeleccionadaId}/fincas/${currentFincaId}/trabajadores`);
        trabajadoresFincaActivos = await resTrab.json();
        
        const listContainer = document.getElementById("jornal-workers-list-inputs");
        
        if (trabajadoresFincaActivos.length === 0) {
            listContainer.innerHTML = `<p style="color: var(--gray); font-style: italic; text-align: center; margin: 1.5rem 0;">No hay ningún trabajador asignado a esta finca. <br>Ve a <strong>Ajustes</strong> para configurar la cuadrilla de esta finca.</p>`;
            return;
        }
        
        // 2. Cargar las horas de ese día en esa finca para la labor específica
        const trabajo = document.getElementById("jornal-trabajo-select").value;
        const resHoras = await fetch(`/api/registro/horas?campana_id=${campanaSeleccionadaId}&finca_id=${currentFincaId}&fecha=${currentFecha}&trabajo=${trabajo}`);
        const horasDia = await resHoras.json();
        
        listContainer.innerHTML = trabajadoresFincaActivos.map(t => {
            const horas = horasDia[t.id] || 0;
            return `
                <div class="worker-row" data-worker-id="${t.id}">
                    <div class="worker-name">👤 ${t.nombre}</div>
                    <div class="worker-controls">
                        <div class="hour-input-wrapper">
                            <button type="button" class="hour-btn" onclick="ajustarHorasJornal(${t.id}, -0.5)">-</button>
                            <input type="number" class="hour-input" id="jornal-hours-${t.id}" value="${horas}" step="0.5" min="0" max="24">
                            <button type="button" class="hour-btn" onclick="ajustarHorasJornal(${t.id}, 0.5)">+</button>
                        </div>
                        <div class="presets-container">
                            <button type="button" class="preset-btn ${horas === 6.5 ? 'active' : ''}" onclick="setPresetJornal(${t.id}, 6.5)">6.5</button>
                            <button type="button" class="preset-btn ${horas === 7 ? 'active' : ''}" onclick="setPresetJornal(${t.id}, 7)">7</button>
                            <button type="button" class="preset-btn ${horas === 8 ? 'active' : ''}" onclick="setPresetJornal(${t.id}, 8)">8</button>
                            <button type="button" class="preset-btn ${horas === 0 ? 'active' : ''}" onclick="setPresetJornal(${t.id}, 0)">0</button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (e) {
        console.error("Error al cargar jornales del día:", e);
    }
}

function ajustarHorasJornal(workerId, delta) {
    const input = document.getElementById(`jornal-hours-${workerId}`);
    let val = parseFloat(input.value) || 0;
    val = Math.max(0, val + delta);
    input.value = val % 1 === 0 ? val.toFixed(0) : val.toFixed(1);
    desmarcarPresetsJornal(workerId);
}

function setPresetJornal(workerId, val) {
    const input = document.getElementById(`jornal-hours-${workerId}`);
    input.value = val;
    
    const row = document.querySelector(`.worker-row[data-worker-id="${workerId}"]`);
    row.querySelectorAll(".preset-btn").forEach(btn => {
        if (parseFloat(btn.innerText) === val) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function desmarcarPresetsJornal(workerId) {
    const row = document.querySelector(`.worker-row[data-worker-id="${workerId}"]`);
    if (row) {
        row.querySelectorAll(".preset-btn").forEach(btn => btn.classList.remove("active"));
    }
}

function setTodosJornal(val) {
    trabajadoresFincaActivos.forEach(t => {
        setPresetJornal(t.id, val);
    });
}

async function guardarJornalJornada() {
    if (!currentFincaId || !campanaSeleccionadaId) return;
    
    const trabajo = document.getElementById("jornal-trabajo-select").value;
    
    const promesas = trabajadoresFincaActivos.map(t => {
        const horas = parseFloat(document.getElementById(`jornal-hours-${t.id}`).value) || 0;
        return fetch('/api/registro/horas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                campana_id: campanaSeleccionadaId,
                finca_id: currentFincaId,
                trabajador_id: t.id,
                fecha: currentFecha,
                horas: horas,
                trabajo: trabajo
            })
        });
    });
    
    try {
        await Promise.all(promesas);
        alert("¡Jornales guardados con éxito!");
        await cargarJornalDia();
    } catch (e) {
        console.error("Error al guardar jornales:", e);
        alert("Error de conexión al guardar jornales.");
    }
}

// --- TAB 4: AÑADIR PESO (ENTREGAS DE KILOS E INCIDENCIAS) ---

async function cargarPesoDia() {
    if (!campanaSeleccionadaId) return;
    
    const select = document.getElementById("peso-finca-select");
    const id = parseInt(select.value);
    const fecha = document.getElementById("peso-fecha-input").value;
    
    if (!id) {
        document.getElementById("peso-deliveries-container").innerHTML = `<p style="color: var(--gray); font-style: italic; text-align: center;">Por favor, selecciona una finca.</p>`;
        return;
    }
    
    sincronizarSelectores(id, fecha);
    
    try {
        // 1. Cargar entregas del día
        const resEnt = await fetch(`/api/registro/entregas?campana_id=${campanaSeleccionadaId}&finca_id=${currentFincaId}&fecha=${currentFecha}`);
        const entregas = await resEnt.json();
        renderizarEntregasPeso(entregas);
        
        // 2. Cargar incidencia del día
        const resInc = await fetch(`/api/registro/incidencias?campana_id=${campanaSeleccionadaId}&finca_id=${currentFincaId}&fecha=${currentFecha}`);
        const incData = await resInc.json();
        document.getElementById("peso-incidencias-input").value = incData.incidencias || "";
        
    } catch (e) {
        console.error("Error al cargar datos de peso:", e);
    }
}

function renderizarEntregasPeso(entregas) {
    const container = document.getElementById("peso-deliveries-container");
    if (!container) return;
    
    if (entregas.length === 0) {
        container.innerHTML = `<p style="color: var(--gray); font-style: italic; text-align: center; margin: 1rem 0;">No hay entregas registradas hoy.</p>`;
        return;
    }
    
    container.innerHTML = entregas.map(e => `
        <div class="delivery-item">
            <div class="delivery-info">
                <span class="badge ${e.tipo.toLowerCase()}">${e.tipo === 'ARBOL' ? '🌲 Árbol' : '🍂 Suelo'}</span>
                <span class="delivery-metrics">
                    <span>${e.kilos.toLocaleString('es-ES')} Kg</span>
                    <span>@ ${e.rendimiento}%</span>
                </span>
            </div>
            <button type="button" class="delete-btn" onclick="eliminarEntregaPeso(${e.id})" title="Eliminar Pesada">🗑️</button>
        </div>
    `).join('');
}

async function agregarEntregaPesoHandler(event) {
    event.preventDefault();
    if (!currentFincaId || !campanaSeleccionadaId) return;
    
    const tipo = document.getElementById("peso-entrega-tipo").value;
    const kilos = parseFloat(document.getElementById("peso-entrega-kilos").value);
    const rendimiento = parseFloat(document.getElementById("peso-entrega-rendimiento").value);
    
    if (!kilos || isNaN(rendimiento)) {
        alert("Introduce valores de kilos y rendimiento válidos.");
        return;
    }
    
    try {
        const res = await fetch('/api/registro/entrega', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                campana_id: campanaSeleccionadaId,
                finca_id: currentFincaId,
                fecha: currentFecha,
                tipo: tipo,
                kilos: kilos,
                rendimiento: rendimiento
            })
        });
        
        if (res.ok) {
            document.getElementById("peso-entrega-kilos").value = "";
            document.getElementById("peso-entrega-rendimiento").value = "";
            await cargarPesoDia();
            await cargarResumenDashboard();
        } else {
            alert("Error al guardar entrega.");
        }
    } catch (e) {
        console.error(e);
    }
}

async function eliminarEntregaPeso(id) {
    if (!confirm("¿Seguro que quieres eliminar esta pesada?")) return;
    
    try {
        const res = await fetch(`/api/registro/entrega/${id}`, { method: 'DELETE' });
        if (res.ok) {
            await cargarPesoDia();
            await cargarResumenDashboard();
        } else {
            alert("Error al borrar entrega.");
        }
    } catch (e) {
        console.error(e);
    }
}

async function guardarNotasPesoJornada() {
    if (!currentFincaId || !campanaSeleccionadaId) return;
    
    const text = document.getElementById("peso-incidencias-input").value;
    
    try {
        const res = await fetch('/api/registro/incidencia', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                campana_id: campanaSeleccionadaId,
                finca_id: currentFincaId,
                fecha: currentFecha,
                incidencias: text
            })
        });
        
        if (res.ok) {
            alert("Notas e incidencias guardadas correctamente.");
            await cargarPesoDia();
        } else {
            alert("Error al guardar notas.");
        }
    } catch (e) {
        console.error(e);
    }
}

// --- TAB RESULTADOS FINALES (CONSOLIDADO) ---

async function cargarResumenConsolidado() {
    if (!campanaSeleccionadaId) return;
    
    try {
        const res = await fetch(`/api/resumen?campana_id=${campanaSeleccionadaId}`);
        const data = await res.json();
        
        // Kilos
        document.getElementById("resumen-kilos-general").innerText = `${data.kilos.total_general.toLocaleString('es-ES')} Kg`;
        document.getElementById("resumen-kilos-arbol").innerText = `${data.kilos.total_arbol.toLocaleString('es-ES')} Kg`;
        document.getElementById("resumen-kilos-suelo").innerText = `${data.kilos.total_suelo.toLocaleString('es-ES')} Kg`;
        
        // Rendimientos
        const rendGeneral = data.rendimientos.rend_medio_general ? data.rendimientos.rend_medio_general.toFixed(2) : '0';
        const rendArbol = data.rendimientos.rend_medio_arbol ? data.rendimientos.rend_medio_arbol.toFixed(2) : '0';
        const rendSuelo = data.rendimientos.rend_medio_suelo ? data.rendimientos.rend_medio_suelo.toFixed(2) : '0';
        
        document.getElementById("resumen-rend-general").innerText = `Rendimiento Medio: ${rendGeneral}%`;
        document.getElementById("resumen-rend-arbol").innerText = `Rendimiento Medio: ${rendArbol}%`;
        document.getElementById("resumen-rend-suelo").innerText = `Rendimiento Medio: ${rendSuelo}%`;
        
        renderizarTablaResumenHoras(data);
    } catch (e) {
        console.error("Error al cargar resumen consolidado:", e);
    }
}

function renderizarTablaResumenHoras(data) {
    const tbody = document.getElementById("tabla-resumen-horas-body");
    const meses = ["Noviembre", "Diciembre", "Enero", "Febrero", "Marzo"];
    
    const desglose = data.trabajadores_desglose;
    const campana = data.trabajadores_campana;
    
    if (campana.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--gray)">No hay registro de horas de trabajadores para esta campaña.</td></tr>`;
        return;
    }
    
    tbody.innerHTML = campana.map(tData => {
        const tNombre = tData.trabajador;
        const desgloseT = desglose[tNombre] || {};
        
        const celdasMeses = meses.map(m => {
            const h = desgloseT[m] || 0;
            return `<td>${h > 0 ? `${h} h` : '-'}</td>`;
        }).join('');
        
        return `
            <tr>
                <td><strong>${tNombre}</strong></td>
                ${celdasMeses}
                <td>${tData.dias_trabajados} días</td>
                <td><strong>${tData.horas_totales} h</strong></td>
            </tr>
        `;
    }).join('');
}

// --- TAB HISTORIAL COMPARATIVO ---

async function cargarHistorialCampanas() {
    try {
        const res = await fetch('/api/historial/campanas');
        const data = await res.json();
        
        const tbody = document.getElementById("tabla-historial-campanas-body");
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--gray)">No hay campañas registradas.</td></tr>`;
            return;
        }
        
        tbody.innerHTML = data.map(row => {
            const total = row.total_general > 0 ? `${row.total_general.toLocaleString('es-ES')} Kg` : '0 Kg';
            const arbol = row.total_arbol > 0 ? `${row.total_arbol.toLocaleString('es-ES')} Kg` : '-';
            const rendArbol = row.rend_medio_arbol > 0 ? `${row.rend_medio_arbol.toFixed(2)}%` : '-';
            const suelo = row.total_suelo > 0 ? `${row.total_suelo.toLocaleString('es-ES')} Kg` : '-';
            const rendSuelo = row.rend_medio_suelo > 0 ? `${row.rend_medio_suelo.toFixed(2)}%` : '-';
            const rendGral = row.rend_medio_general > 0 ? `${row.rend_medio_general.toFixed(2)}%` : '-';
            
            return `
                <tr>
                    <td><strong>Campaña ${row.campana_nombre}</strong></td>
                    <td><strong>${total}</strong></td>
                    <td>${arbol}</td>
                    <td>${rendArbol}</td>
                    <td>${suelo}</td>
                    <td>${rendSuelo}</td>
                    <td><strong>${rendGral}</strong></td>
                </tr>
            `;
        }).join('');
        
    } catch (e) {
        console.error("Error al cargar historial:", e);
    }
}

// --- TAB COMPARACIÓN ---

async function cargarComparativaGeneral() {
    try {
        const res = await fetch('/api/comparativa/campanas');
        const data = await res.json();
        
        const tbody = document.getElementById("tabla-comparativa-general-body");
        if (!tbody) return;
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--gray)">No hay campañas registradas.</td></tr>`;
            return;
        }
        
        tbody.innerHTML = data.map(row => `
            <tr>
                <td><strong>Campaña ${row.campana_nombre}</strong></td>
                <td>${row.total_fincas} fincas</td>
                <td>${row.total_horas > 0 ? `${row.total_horas} h` : '-'}</td>
                <td><strong>${row.kilos_total > 0 ? `${row.kilos_total.toLocaleString('es-ES')} Kg` : '-'}</strong></td>
                <td>${row.kilos_arbol > 0 ? `${row.kilos_arbol.toLocaleString('es-ES')} Kg` : '-'}</td>
                <td>${row.kilos_suelo > 0 ? `${row.kilos_suelo.toLocaleString('es-ES')} Kg` : '-'}</td>
            </tr>
        `).join('');
        
    } catch (e) {
        console.error("Error al cargar comparativa general:", e);
    }
}

async function cargarComparativaFinca() {
    const select = document.getElementById("comparacion-finca-select");
    if (!select) return;
    const fincaId = parseInt(select.value);
    
    const tbody = document.getElementById("tabla-comparativa-finca-body");
    const analisisDiv = document.getElementById("comparativa-finca-analisis");
    if (!tbody || !analisisDiv) return;
    
    if (!fincaId) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--gray)">Selecciona una finca arriba.</td></tr>`;
        analisisDiv.innerHTML = "";
        return;
    }
    
    // Sincronizar estado global
    sincronizarSelectores(fincaId, currentFecha);
    
    try {
        const res = await fetch(`/api/comparativa/finca/${fincaId}`);
        const data = await res.json();
        
        if (data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--gray)">No hay datos registrados de esta finca en ninguna campaña.</td></tr>`;
            analisisDiv.innerHTML = "";
            return;
        }
        
        tbody.innerHTML = data.map(row => {
            const total = row.kilos_total > 0 ? `${row.kilos_total.toLocaleString('es-ES')} Kg` : '-';
            const arbol = row.kilos_arbol > 0 ? `${row.kilos_arbol.toLocaleString('es-ES')} Kg` : '-';
            const rendArbol = row.rend_medio_arbol > 0 ? `${row.rend_medio_arbol.toFixed(2)}%` : '-';
            const suelo = row.kilos_suelo > 0 ? `${row.kilos_suelo.toLocaleString('es-ES')} Kg` : '-';
            const rendSuelo = row.rend_medio_suelo > 0 ? `${row.rend_medio_suelo.toFixed(2)}%` : '-';
            
            return `
                <tr>
                    <td><strong>Campaña ${row.campana_nombre}</strong></td>
                    <td>${row.horas_totales > 0 ? `${row.horas_totales} h` : '-'}</td>
                    <td><strong>${total}</strong></td>
                    <td>${arbol}</td>
                    <td>${rendArbol}</td>
                    <td>${suelo}</td>
                    <td>${rendSuelo}</td>
                </tr>
            `;
        }).join('');
        
        // Análisis de eficiencia dinámica entre campañas
        if (data.length >= 2) {
            let html = "";
            
            // 1. Calcular eficiencia de recolección (Kg/Hora)
            // Tomamos las últimas 2 campañas disponibles para comparar
            const c1 = data[0]; // Campaña más reciente (por orden DESC de nombre)
            const c2 = data[1]; // Campaña anterior
            
            const ef1 = c1.horas_totales > 0 ? (c1.kilos_total / c1.horas_totales) : 0;
            const ef2 = c2.horas_totales > 0 ? (c2.kilos_total / c2.horas_totales) : 0;
            
            html += `
                <div class="card" style="border-left: 4px solid var(--primary); background-color: var(--primary-bg);">
                    <h4 style="margin-bottom: 0.5rem; color: var(--primary);">⚡ Rendimiento por Hora de Trabajo</h4>
                    <p style="font-size: 0.95rem; line-height: 1.4; margin: 0;">
                        En la campaña <strong>${c1.campana_nombre}</strong> se recolectaron <strong>${ef1.toFixed(1)} Kg/h</strong> (horas: ${c1.horas_totales}h, kilos: ${c1.kilos_total.toLocaleString('es-ES')} Kg). <br>
                        En la campaña <strong>${c2.campana_nombre}</strong> se recolectaron <strong>${ef2.toFixed(1)} Kg/h</strong> (horas: ${c2.horas_totales}h, kilos: ${c2.kilos_total.toLocaleString('es-ES')} Kg).
                    </p>
            `;
            
            if (ef1 > 0 && ef2 > 0) {
                const diffPct = ((ef1 - ef2) / ef2) * 100;
                if (diffPct > 0) {
                    html += `<p style="margin-top: 0.5rem; font-weight: 600; color: #4b6a2e;">📈 ¡La recolección en ${c1.campana_nombre} fue un ${diffPct.toFixed(1)}% más eficiente por hora de trabajo!</p>`;
                } else if (diffPct < 0) {
                    html += `<p style="margin-top: 0.5rem; font-weight: 600; color: #a94442;">📉 La eficiencia cayó un ${Math.abs(diffPct).toFixed(1)}% en ${c1.campana_nombre} respecto a ${c2.campana_nombre}.</p>`;
                }
            }
            html += `</div>`;
            
            // 2. Comparativa de Proporción Árbol vs Suelo
            const propArbol1 = c1.kilos_total > 0 ? (c1.kilos_arbol / c1.kilos_total) * 100 : 0;
            const propArbol2 = c2.kilos_total > 0 ? (c2.kilos_arbol / c2.kilos_total) * 100 : 0;
            
            html += `
                <div class="card" style="border-left: 4px solid var(--secondary); background-color: var(--primary-bg);">
                    <h4 style="margin-bottom: 0.5rem; color: var(--secondary-dark);">🌲 Proporción Árbol (Vuelo)</h4>
                    <p style="font-size: 0.95rem; line-height: 1.4; margin: 0;">
                        Proporción de aceituna recogida de vuelo (árbol) respecto al total:<br>
                        Campaña <strong>${c1.campana_nombre}</strong>: <strong>${propArbol1.toFixed(1)}%</strong> (${c1.kilos_arbol.toLocaleString('es-ES')} Kg)<br>
                        Campaña <strong>${c2.campana_nombre}</strong>: <strong>${propArbol2.toFixed(1)}%</strong> (${c2.kilos_arbol.toLocaleString('es-ES')} Kg)
                    </p>
                </div>
            `;
            
            analisisDiv.innerHTML = html;
        } else {
            analisisDiv.innerHTML = `<div class="card" style="grid-column: 1 / -1; text-align: center; color: var(--gray); font-style: italic;">Se necesitan datos de al menos 2 campañas para generar análisis automáticos de eficiencia de esta finca.</div>`;
        }
        
    } catch (e) {
        console.error("Error al cargar comparativa de finca:", e);
    }
}

// --- TRABAJOS EN FINCAS (SUB-NAVEGACIÓN) ---

function switchSubTrabajo(subId) {
    // Desactivar todos los botones de sub-navegación
    document.querySelectorAll(".sub-nav-btn").forEach(btn => btn.classList.remove("active"));
    
    // Activar el botón seleccionado
    const selectedBtn = document.getElementById(`sub-btn-${subId}`);
    if (selectedBtn) selectedBtn.classList.add("active");
    
    // Ocultar todos los subcontenidos
    document.querySelectorAll(".sub-trabajo-content").forEach(content => {
        content.style.display = "none";
        content.classList.remove("active");
    });
    
    // Mostrar el subcontenido seleccionado
    const selectedContent = document.getElementById(`sub-content-${subId}`);
    if (selectedContent) {
        selectedContent.style.display = "block";
        selectedContent.classList.add("active");
    }
    
    // Cargar los análisis dinámicos de esta sub-labor
    cargarAnalisisTrabajo(subId);
}

// --- ANÁLISIS DE TRABAJOS ---

function cargarAnalisisTrabajoActivo() {
    const activeSub = document.querySelector(".sub-nav-btn.active");
    const subId = activeSub ? activeSub.id.replace("sub-btn-", "") : "recolecta";
    cargarAnalisisTrabajo(subId);
}

async function cargarAnalisisTrabajo(subId) {
    if (!campanaSeleccionadaId) return;
    
    const dbTrabajo = subId.replace('-', '_').toUpperCase();
    
    try {
        const res = await fetch(`/api/trabajos/analisis?campana_id=${campanaSeleccionadaId}&trabajo=${dbTrabajo}`);
        const data = await res.json();
        
        renderizarAnalisisTrabajo(subId, data);
    } catch (e) {
        console.error("Error al cargar análisis de trabajo:", e);
    }
}

function renderizarAnalisisTrabajo(subId, data) {
    const container = document.getElementById(`sub-content-${subId}`);
    if (!container) return;
    
    if (data.horas_totales === 0) {
        container.innerHTML = `
            <div class="card" style="text-align: center; padding: 3rem 2rem; color: var(--gray);">
                <h3>No hay registros</h3>
                <p>Aún no se han registrado horas de trabajo para la labor "${data.trabajo}" en la campaña actual.</p>
            </div>
        `;
        return;
    }
    
    const fincasHTML = data.desglose_finca.map(f => `
        <tr>
            <td><strong>🚜 ${f.finca}</strong></td>
            <td><strong>${f.horas} h</strong></td>
        </tr>
    `).join('');
    
    const trabajadoresHTML = data.desglose_trabajador.map(t => `
        <tr>
            <td><strong>👤 ${t.trabajador}</strong></td>
            <td><strong>${t.horas} h</strong></td>
        </tr>
    `).join('');
    
    container.innerHTML = `
        <div class="dashboard-grid" style="margin-bottom: 1.5rem;">
            <div class="card stat-card">
                <div class="stat-icon">⏱️</div>
                <div class="stat-info">
                    <h3>Total Horas Invertidas</h3>
                    <p class="stat-value">${data.horas_totales} h</p>
                </div>
            </div>
        </div>
        
        <div class="finca-grid" style="grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1.5rem;">
            <div class="card">
                <h3>🚜 Distribución por Finca</h3>
                <div class="table-responsive">
                    <table class="data-table">
                          <thead>
                              <tr>
                                  <th>Finca</th>
                                  <th>Horas</th>
                              </tr>
                          </thead>
                        <tbody>
                            ${fincasHTML}
                        </tbody>
                    </table>
                </div>
            </div>
            <div class="card">
                <h3>👤 Distribución por Trabajador</h3>
                <div class="table-responsive">
                    <table class="data-table">
                          <thead>
                              <tr>
                                  <th>Trabajador</th>
                                  <th>Horas</th>
                              </tr>
                          </thead>
                        <tbody>
                            ${trabajadoresHTML}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;
}

function irAAjustesCuadrilla() {
    switchTab('config');
    const select = document.getElementById("assign-finca-select");
    if (select) {
        if (currentFincaId) {
            select.value = currentFincaId;
            cargarAsignacionTrabajadoresFinca();
        }
        setTimeout(() => {
            select.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
    }
}

async function cargarMapaCatastralFinca() {
    const cardMap = document.getElementById("card-mapa-catastro");
    const detallesDiv = document.getElementById("catastro-detalles-info");
    
    if (!cardMap || !detallesDiv) return;
    
    // Destruir mapa si existe
    if (mapaFinca) {
        mapaFinca.remove();
        mapaFinca = null;
    }
    
    const finca = fincasGlobales.find(f => f.id === currentFincaId);
    if (!finca) {
        cardMap.style.display = "none";
        return;
    }
    
    // Si no tiene parcelas de tabla pero sí antiguas de compatibilidad, armamos la lista
    let parcelas = finca.parcelas || [];
    if (parcelas.length === 0 && finca.poligono && finca.parcela) {
        parcelas = [{
            provincia: finca.provincia || "JAEN",
            municipio: finca.municipio || "ALCALA LA REAL",
            poligono: finca.poligono,
            parcela: finca.parcela,
            referencia_catastral: finca.referencia_catastral,
            superficie_m2: finca.superficie_m2,
            latitude: finca.latitude,
            longitude: finca.longitude,
            localizacion: finca.localizacion
        }];
    }
    
    if (parcelas.length === 0) {
        cardMap.style.display = "none";
        return;
    }
    
    cardMap.style.display = "flex";
    
    // Calcular superficie total
    const totalArea = parcelas.reduce((acc, curr) => acc + (curr.superficie_m2 || 0), 0);
    const totalHa = (totalArea / 10000).toFixed(2);
    
    // Renderizar detalles de todas las parcelas
    let html = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.5rem; width: 100%;">
            <div>📐 <strong>Superficie Total:</strong> <strong>${totalArea.toLocaleString('es-ES')} m² (${totalHa} ha)</strong></div>
            <div style="font-size: 0.9rem; border-top: 1px solid var(--border); padding-top: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; max-height: 250px; overflow-y: auto;">
    `;
    
    parcelas.forEach((p, idx) => {
        html += `
            <div style="background-color: var(--primary-bg); padding: 0.5rem; border-radius: 6px; border: 1px solid var(--primary-light);">
                <strong>Parcela ${idx + 1}:</strong> Pol. ${p.poligono} Parc. ${p.parcela}<br>
                📌 <em>Paraje:</em> ${p.localizacion || 'No disponible'}<br>
                📐 <em>Superficie:</em> ${p.superficie_m2 ? `${p.superficie_m2.toLocaleString('es-ES')} m²` : 'No disponible'}<br>
                🔑 <em>Ref. Catastral:</em> <code style="font-size:0.8rem; background:var(--light); padding:0.1rem 0.2rem; border-radius:3px;">${p.referencia_catastral || 'No disponible'}</code>
                ${p.latitude ? `
                <div style="margin-top: 0.25rem; display: flex; gap: 0.3rem;">
                    <a href="https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}" target="_blank" style="font-size: 0.75rem; text-decoration: none; color: var(--primary);">🚗 Google Maps</a> |
                    <a href="https://www1.catastro.meh.es/Cartografia/mapa.aspx?refcat=${p.referencia_catastral}" target="_blank" style="font-size: 0.75rem; text-decoration: none; color: var(--primary);">🗺️ Ficha</a>
                </div>
                ` : ''}
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    
    detallesDiv.innerHTML = html;
    
    // Obtener todas las que tengan coordenadas
    const coordsValidas = parcelas.filter(p => p.latitude && p.longitude);
    
    if (coordsValidas.length > 0) {
        setTimeout(() => {
            try {
                // Inicializar mapa de Leaflet
                const center = [coordsValidas[0].latitude, coordsValidas[0].longitude];
                mapaFinca = L.map('mapa-finca').setView(center, 17);
                
                // Imagen satélite de ESRI World Imagery
                L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                    maxZoom: 19,
                    attribution: 'Satélite Esri'
                }).addTo(mapaFinca);
                
                // Superponer las parcelas del Catastro de España mediante WMS
                L.tileLayer.wms('https://ovc.catastro.meh.es/Cartografia/WMS/ServidorWMS.aspx', {
                    layers: 'PARCELA',
                    format: 'image/png',
                    transparent: true,
                    version: '1.1.1',
                    attribution: '© Dirección General del Catastro'
                }).addTo(mapaFinca);
                
                // Añadir marcador para cada parcela y colectar puntos para ajustar límites
                const leafletCoords = [];
                coordsValidas.forEach((p, idx) => {
                    const latlng = [p.latitude, p.longitude];
                    leafletCoords.push(latlng);
                    
                    L.marker(latlng).addTo(mapaFinca)
                        .bindPopup(`<b>${finca.nombre} (P.${idx + 1})</b><br>Polígono ${p.poligono} Parcela ${p.parcela}<br>${p.superficie_m2 ? `${(p.superficie_m2/10000).toFixed(2)} ha` : ''}`);
                });
                
                // Si hay más de una parcela, ajustar encuadre para ver todas
                if (leafletCoords.length > 1) {
                    const bounds = L.latLngBounds(leafletCoords);
                    mapaFinca.fitBounds(bounds, { padding: [40, 40] });
                } else if (leafletCoords.length === 1) {
                    mapaFinca.setView(leafletCoords[0], 17);
                }
            } catch (e) {
                console.error("Error al renderizar el mapa Leaflet:", e);
            }
        }, 150);
    }
}
