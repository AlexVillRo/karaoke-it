Despliega el proyecto KaraokIT localmente siguiendo estos pasos en orden:

## Pasos de despliegue

**IMPORTANTE:** Ejecuta cada paso con Bash y espera su resultado antes de continuar.

### 1. Verificar/matar procesos en puertos 3000 y 1999
```
powershell -Command "
  @(3000,1999) | ForEach-Object {
    $port = $_
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds 800
  Write-Host done
"
```

### 2. Iniciar servidores (background)
- Directorio: `c:/Users/junio/OneDrive/Documentos/KaraokIT/karaoke-game`
- Comando: `npm run dev:all`
- Ejecutar en background con `run_in_background: true`

### 3. Esperar que los puertos 3000 y 1999 estén escuchando
Espera ~15 segundos y verifica con:
```
powershell -Command "Get-NetTCPConnection -LocalPort 3000,1999 -State Listen -ErrorAction SilentlyContinue | Select-Object LocalPort, OwningProcess | Format-Table"
```

### 4. Iniciar túneles Cloudflare (ambos en background)
- Ejecutable: `"/c/Users/junio/AppData/Local/Microsoft/WinGet/Packages/Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe/cloudflared.exe"`
- Puerto 3000: `"$CF" tunnel --url http://localhost:3000 2> "c:/Users/junio/OneDrive/Documentos/KaraokIT/cf3000.err.log"`
- Puerto 1999: `"$CF" tunnel --url http://localhost:1999 2> "c:/Users/junio/OneDrive/Documentos/KaraokIT/cf1999.err.log"`
- Ambos con `run_in_background: true`

### 5. Esperar y extraer URLs (espera ~10 segundos)
```
node -e "
const fs = require('fs');
['cf3000','cf1999'].forEach(name => {
  const c = fs.readFileSync('c:/Users/junio/OneDrive/Documentos/KaraokIT/'+name+'.err.log', 'latin1');
  const m = c.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  console.log(name+':', m ? m[m.length-1] : 'no encontrado aun');
});
"
```
Si alguna URL no apareció, esperar 5 segundos más y reintentar (máximo 3 intentos).

### 6. Actualizar .env.local
```
printf 'NEXT_PUBLIC_PARTYKIT_HOST=DOMINIO_1999\nNEXT_PUBLIC_APP_HOST=DOMINIO_3000\n' > "c:/Users/junio/OneDrive/Documentos/KaraokIT/karaoke-game/.env.local"
```
(usar solo el dominio sin `https://`)

### 7. Reiniciar Next.js para tomar las nuevas variables
Matar el proceso en puerto 3000 y relanzar `npm run dev` en background desde el directorio del proyecto.

### 8. Esperar ~8 segundos y verificar que Next.js respondió

### 9. Reportar al usuario
Mostrar claramente:
- URL del host/lobby: `https://DOMINIO_3000`
- URL de PartyKit: dominio de 1999 (para referencia)
- Recordar que el QR del lobby genera el link de jugadores automáticamente

## Notas
- Los logs de cloudflared van a `c:/Users/junio/OneDrive/Documentos/KaraokIT/cf3000.err.log` y `cf1999.err.log`
- Si un puerto ya está ocupado al iniciar, mátalo primero
- Las URLs de Cloudflare cambian cada vez que se reinician los túneles
- PartyKit (1999) generalmente no necesita reinicio — solo Next.js necesita leer las nuevas vars
