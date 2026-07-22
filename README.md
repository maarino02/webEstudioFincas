# 🚜 Cuadrante de Cosechas - Estudio de Fincas

Una aplicación web progresiva (PWA) diseñada específicamente para la **gestión agrícola y el seguimiento de campañas de recolección de aceituna**. Permite a los agricultores y gestores de fincas llevar un control exhaustivo de trabajadores, horas invertidas, labores realizadas y kilos recolectados, ofreciendo herramientas de análisis comparativo entre diferentes campañas.

## ✨ Características Principales

*   **Catálogo Global de Fincas y Trabajadores:** Gestión centralizada de la plantilla de trabajadores y del listado de fincas.
*   **Integración Oficial con el Catastro:** Búsqueda y vinculación automática de datos catastrales (Referencia Catastral, Superficie, Coordenadas y Localización) introduciendo únicamente el Polígono y la Parcela de cualquier finca en España.
*   **Gestión Multicampaña:** Creación de múltiples campañas (ej. "24/25", "25/26") para separar los datos y poder realizar comparativas de eficiencia y rendimiento interanual.
*   **Registro Diario de Jornales:** Asignación rápida de horas de trabajo por empleado y por finca, categorizando la labor realizada (Recolecta, Curar, Abono, Varetas, Desbrozar, Recoger piedras, etc.).
*   **Control de Entregas y Kilos:** Registro de pesadas/entregas en la almazara, diferenciando el origen de la aceituna (Árbol/Vuelo o Suelo) y registrando el rendimiento graso (%).
*   **Análisis y Estadísticas:**
    *   Dashboard en tiempo real con kilos totales y rendimientos medios.
    *   Resumen consolidado de horas trabajadas por empleado al mes.
    *   Estudio comparativo de eficiencia de recolección (Kg/Hora) por finca a lo largo de los años.
*   **Soporte Offline (PWA):** Instalable en teléfonos móviles y ordenadores como una aplicación nativa. Incluye Service Workers para poder seguir consultando la interfaz incluso sin conexión a internet.

## 🛠️ Stack Tecnológico

*   **Backend:** [Python](https://www.python.org/) + [FastAPI](https://fastapi.tiangolo.com/)
*   **Base de Datos:** SQLite (ligera, embebida y sin necesidad de configuración externa).
*   **Frontend:** HTML5, CSS3 (Vanilla) y JavaScript (ES6+).
*   **Integraciones:** API SOAP del Catastro Español (Ministerio de Hacienda).

## 🚀 Instalación y Ejecución Local

Para ejecutar este proyecto en tu entorno local, asegúrate de tener Python instalado (se recomienda versión 3.9 o superior).

1.  **Clona este repositorio** en tu equipo local.
2.  **Instala las dependencias** necesarias de Python (FastAPI, Uvicorn y Requests para las llamadas al Catastro):
    ```bash
    pip install fastapi uvicorn requests
    ```
3.  **Inicia el servidor backend** utilizando Uvicorn:
    ```bash
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    ```
4.  **Abre tu navegador** y visita `http://localhost:8000`.

## 📱 Instalación en Móvil (PWA)

Al abrir la dirección de la web desde el navegador de tu móvil (Chrome, Safari, etc.), verás la opción de **"Añadir a la pantalla de inicio"** o **"Instalar aplicación"**. Esto descargará los archivos esenciales y colocará un icono junto al resto de tus aplicaciones, permitiéndote abrir el sistema a pantalla completa de forma rápida.

## 🗄️ Estructura del Proyecto

*   `main.py`: Archivo principal del servidor FastAPI. Define todos los endpoints y la comunicación HTTP.
*   `database.py`: Lógica de conexión a SQLite, consultas SQL y llamadas a la API externa del Catastro.
*   `static/`: Carpeta que contiene todos los archivos del Frontend.
    *   `index.html`: Estructura principal de la aplicación.
    *   `style.css`: Hojas de estilo y diseño adaptable (responsive).
    *   `app.js`: Lógica de la interfaz, eventos, llamadas al backend y gráficos.
    *   `manifest.json` y `sw.js`: Archivos de configuración para convertir la web en una PWA (Progressive Web App).
*   `.agents/`: Configuración interna para asistentes de IA y flujos de trabajo automatizados.
