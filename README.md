# 🔄 Sincronizador Kommo CRM ↔ GoHighLevel (GHL) por API

Microservicio backend en **Node.js (ESM)** para enriquecer y sincronizar contactos automáticamente entre **Kommo CRM** y **GoHighLevel (GHL)** mediante sus APIs oficiales REST v4 y v2.

---

## 🎯 ¿Qué problema resuelve?

En **Kommo CRM**, los webhooks nativos por diseño son extremadamente ligeros: únicamente envían identificadores (`contacts[add][0][id]`), sin los campos personalizados ni el teléfono completo. Además, en los bots de chat (Salesbot), muchas veces el webhook se dispara antes de que los datos del contacto se almacenen completamente.

**Esta solución resuelve el problema mediante llamadas API directas:**
1. **Recibe la notificación** (con el simple `contact_id` o `lead_id`).
2. **Consulta la API v4 de Kommo** para obtener el contacto completo y extraer el número telefónico real.
3. **Normaliza el teléfono** (soporta variantes internacionales E.164, sin código de país, y el `1` de WhatsApp en México).
4. **Consulta la API v2 de GoHighLevel** buscando si el contacto existe.
5. **Si existe en GHL:** Extrae **Nombre, Apellido, Email y Etiquetas (Tags)** y los actualiza de inmediato en Kommo.
6. **Agrega una Nota interna** en la línea de tiempo del contacto en Kommo para trazabilidad del equipo de ventas.

---

## 🖥️ Panel Gráfico Web (GUI)

El proyecto incluye un dashboard web interactivo para gestionar la sincronización sin tener que usar la terminal:
- **Panel & Monitor:** Estado de conexión en tiempo real de Kommo y GHL, métricas y feed en vivo de leads sincronizados.
- **Simulador de Prueba:** Permite probar cualquier ID de contacto o teléfono y ver el pipeline de ejecución paso a paso con las respuestas de las APIs.
- **Editor de Credenciales:** Guarda y actualiza tu `.env` directamente desde la interfaz con botones de prueba de conexión.
- **Guía de Integración:** Instrucciones paso a paso para configurar los webhooks en Kommo.

Para abrir la interfaz:
```bash
npm run dev
# Abre en tu navegador: http://localhost:3000
```

---

## 📁 Estructura del Proyecto

```text
KOMMO/
├── public/               # Interfaz Gráfica Web (HTML5, CSS3, JS Vanilla)
│   ├── index.html        # Dashboard, simulador, configuración y guía
│   ├── styles.css        # Diseño oscuro con glassmorphism y microinteracciones
│   └── app.js            # Lógica reactiva del cliente
├── src/
│   ├── config.js         # Lectura, validación y persistencia de .env
│   ├── server.js         # Servidor Express, SPA fallback y static assets
│   ├── routes/
│   │   ├── api.js        # API REST para el panel gráfico
│   │   └── webhook.js    # Endpoints /webhook/kommo-lead y /api/sync-test
│   ├── services/
│   │   ├── kommo.js      # Cliente API v4 de Kommo (GET, PATCH, Notas)
│   │   ├── ghl.js        # Cliente API v2 de GHL (Búsqueda por duplicado/query)
│   │   ├── sync.js       # Orquestador del flujo de sincronización
│   │   └── history.js    # Registro de eventos en vivo y estadísticas
│   └── utils/
│       └── phone.js      # Limpieza, normalización y variantes de teléfonos
├── scripts/
│   └── test-contact.js   # Script CLI para pruebas directas en terminal
├── .env.example          # Plantilla con explicación de credenciales
├── package.json
└── README.md
```

---

## 🚀 Paso 1: Configurar Credenciales (.env)

Copia el archivo de ejemplo a `.env`:
```bash
cp .env.example .env
```

Edita `.env` con tus credenciales:

### 1. Kommo CRM:
* **`KOMMO_SUBDOMAIN`**: El nombre de tu cuenta (ejemplo: si accedes a `https://miempresa.kommo.com`, coloca `miempresa`).
* **`KOMMO_ACCESS_TOKEN`**:
  1. En tu panel de Kommo, ve a **Ajustes** → **Integraciones**.
  2. Haz clic en **Crear integración privada** (arriba a la derecha).
  3. Dale un nombre (ej: `GHL Sync API`) y otorga permisos de lectura/escritura a Contactos y Leads.
  4. En la pestaña **Claves y alcances**, copia el **Token de acceso de larga duración**.

### 2. GoHighLevel (GHL):
* **`GHL_LOCATION_ID`**:
  1. En tu subcuenta de GHL, ve a **Settings** → **Business Info** (o Settings → Company).
  2. Copia el **Location ID**.
* **`GHL_ACCESS_TOKEN`**:
  1. En GHL ve a **Settings** → **Developers** → **Private Integrations** (o API Keys).
  2. Genera una integración privada con permisos para `contacts.readonly` y `contacts.write`.
  3. Copia el token de acceso generado.

---

## 🧪 Paso 2: Probar la Sincronización en Terminal

Antes de tocar webhooks en Kommo, puedes probar el flujo directamente con un contacto o teléfono real:

```bash
# Probar con un ID de contacto de Kommo:
node scripts/test-contact.js --contact 12345678

# O probar buscando directamente un teléfono en GHL para asociarlo a un contacto de Kommo:
node scripts/test-contact.js --phone "+525512345678" --contact 12345678
```

El script te mostrará en pantalla:
- Los datos leídos de Kommo.
- El resultado de la búsqueda en GHL.
- La confirmación de actualización de Nombre, Email, Etiquetas y la Nota agregada.

---

## 🌐 Paso 3: Iniciar el Servidor

Modo desarrollo con recarga automática:
```bash
npm run dev
```

Modo producción:
```bash
npm start
```

Endpoints disponibles:
- `POST http://localhost:3000/webhook/kommo-lead` : Recibe las alertas de Kommo.
- `POST http://localhost:3000/api/sync-test` : Endpoint síncrono para tests.
- `GET http://localhost:3000/health` : Comprobación de estado del servicio.

---

## ⚡ Paso 4: Configurar el Disparador en Kommo CRM

Tienes dos formas sencillas de activarlo:

### Opción A: Desde Automatizaciones / Embudo Digital (Recomendada si usas Salesbot)
1. En tu Embudo de Ventas (Digital Pipeline), en la etapa donde entran tus leads (ej: "Primer Contacto").
2. Agrega una acción: **Webhook** o llamada dentro de tu **Salesbot**.
3. URL: `https://tu-dominio.com/webhook/kommo-lead`
4. Método: `POST`
5. Parámetros / Body: Puedes enviar `contact_id={{contact.id}}` o dejar que Kommo envíe el payload por defecto.

### Opción B: Webhook Global de Kommo
1. En Kommo ve a **Ajustes** → **Integraciones** → **Webhooks**.
2. Haz clic en **Añadir Webhook**.
3. URL: `https://tu-dominio.com/webhook/kommo-lead`
4. Eventos a marcar:
   - `Contacto añadido`
   - O `Lead añadido`
5. Guarda los cambios.

---

## 🛡️ Seguridad Opcional

Si deseas que nadie más pueda invocar tu webhook, define en tu `.env`:
```env
WEBHOOK_SECRET=mi_clave_secreta_super_segura
```
Y en Kommo configura la URL del webhook con el parámetro:
`https://tu-dominio.com/webhook/kommo-lead?secret=mi_clave_secreta_super_segura`
