# Catio Builder 🐱

Juego de construcción tipo City Builder para móvil y PC. Construye un catio hexagonal para gatos, mantén sus necesidades cubiertas y haz crecer tu colonia felina.

## Cómo jugar

1. Abre `index.html` en un navegador moderno (Chrome, Firefox, Safari, Edge).
2. Para desarrollo local con módulos ES, usa un servidor estático:

```bash
npx serve .
# o
python -m http.server 8080
```

3. Crea hasta **3 partidas** — se guardan automáticamente en el dispositivo (localStorage).
4. Elige **dificultad** al crear: Tranquilo, Equilibrado o Salvaje.
5. Toca un elemento del menú inferior, luego una casilla del mapa para construir.
6. Desliza para mover la cámara; rueda del ratón para zoom (PC).

## Mecánicas

- **Recursos:** Croquetas 🍪 — ingreso pasivo según felicidad promedio.
- **Necesidades:** Alimento, descanso, entretención, salud, temperatura e higiene.
- **Areneros:** Esenciales para higiene; sin ellos la felicidad cae rápido.
- **Cama doble:** Aloja 2 gatos y suma +2 al límite.
- **Mejoras:** Planta gatera, lámpara y jardín se mejoran tocando el edificio (★2, ★3).
- **Casillas:** Precio base 8 + 3 por cada casilla ya comprada (incremento bajo).
- **Límite de gatos:** Base 2 + camas/refugios + 1 cada 4 casillas.

## Controles HUD

| Elemento | Acción |
|----------|--------|
| 😸 Felicidad | Detalle por gato + aviso si alguno está muy bajo |
| 🐾 Gatos | Fórmula del límite de población |
| ☰ Menú | Guardar manual / volver al menú |

## Estructura

```
index.html
css/style.css
js/
  config.js    — edificios, dificultad, constantes
  hex.js       — grid hexagonal estilo Catan
  cats.js      — gatos, necesidades, economía
  save.js      — 3 slots en localStorage
  renderer.js  — escena 3D low-poly (Three.js)
  audio.js     — música ambiental y efectos (Web Audio)
  ui.js        — interfaz mobile-first
  main.js      — bucle de juego
  vendor/      — Three.js vendorizado (funciona offline)
```

## Licencia

Proyecto personal — úsalo y modifícalo libremente.
