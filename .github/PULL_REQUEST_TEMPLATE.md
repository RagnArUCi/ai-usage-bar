## Qué cambia

<!-- Y por qué. Si arregla una incidencia: Cierra #N -->

## Comprobado

- [ ] `npm test`
- [ ] `npx electron-builder --dir` — **obligatorio si tocaste `package.json` o el workflow**;
      los tests no detectan una configuración de compilación inválida
- [ ] Probado en la app real, no solo en tests

## Si añade o cambia un proveedor

- [ ] Verificado contra una cuenta real
- [ ] `docs/providers/<id>.md` creado o actualizado
- [ ] Tests del parser con un recorte real de la respuesta
- [ ] No se muestra ningún número cuando no hay dato real
- [ ] Ningún token aparece en logs ni en mensajes de error
- [ ] Ningún secreto añadido al repositorio

## Si toca el panel

- [ ] Revisado en tema claro y oscuro
- [ ] Revisado con la pastilla seleccionada (las marcas heredan `currentColor`)
