// Notificacao do Windows (canto da tela) quando algo da errado. Sem repetir o mesmo aviso em 30 min nem mais de 1 por minuto.
const { spawn } = require('child_process');
const PS = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$x = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$n = $x.GetElementsByTagName('text')
$n.Item(0).AppendChild($x.CreateTextNode($env:BOT_T)) > $null
$n.Item(1).AppendChild($x.CreateTextNode($env:BOT_X)) > $null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))`;

const vistos = new Map(); let ultimo = 0;
function avisar(titulo, texto, { agora = Date.now(), plataforma = process.platform, executar = spawn } = {}) {
  const chave = titulo + '|' + texto;
  if (agora - (vistos.get(chave) || 0) < 30 * 60e3 || agora - ultimo < 60e3) return false;
  vistos.set(chave, agora); ultimo = agora;
  if (plataforma !== 'win32') return true;
  try {
    executar('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', PS], { env: { ...process.env, BOT_T: titulo, BOT_X: String(texto).slice(0, 200) }, windowsHide: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {}
  return true;
}
module.exports = { avisar };
