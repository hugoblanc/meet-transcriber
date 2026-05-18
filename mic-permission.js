const btn = document.getElementById('btn-grant');
const status = document.getElementById('status');
const hint = document.getElementById('hint');

btn.addEventListener('click', async () => {
  btn.disabled = true;
  btn.textContent = 'Demande en cours…';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    status.className = 'status success';
    status.textContent = 'Microphone autorisé !';
    btn.textContent = 'Autorisé';
    hint.textContent =
      "Vous pouvez fermer cet onglet et relancer l'enregistrement depuis l'extension.";
  } catch (e) {
    status.className = 'status error';
    if (e.name === 'NotAllowedError') {
      status.textContent = 'Permission refusée.';
      hint.textContent =
        "Si le prompt n'apparaît pas, allez dans chrome://settings/content/microphone et autorisez cette extension.";
    } else {
      status.textContent = e.message;
    }
    btn.disabled = false;
    btn.textContent = 'Réessayer';
  }
});
