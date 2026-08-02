(() => {
  const languages = {
    en: { name: 'English', messages: {} },
    es: {
      name: 'Español',
      messages: {
        'Open dashboard': 'Abrir panel', 'Progress-aware monitoring': 'Monitoreo con progreso', 'See where your job is.': 'Vea dónde está su tarea.',
        'PingStep shows the last stage your job reached and makes lost visibility clear, so you do not have to keep checking logs or guessing.': 'PingStep muestra la última etapa que alcanzó su tarea y deja clara la pérdida de visibilidad, para que no tenga que revisar registros ni adivinar.',
        'Send a few small lifecycle events. Keep your logs and job data where they already are.': 'Envíe unos pocos eventos pequeños del ciclo de vida. Mantenga sus registros y datos donde ya están.',
        'Monitor a job': 'Monitorear una tarea', 'What you see': 'Lo que ve', 'Running': 'En ejecución', 'Succeeded': 'Completado', 'Failed': 'Con errores', 'Stale': 'Sin actualizaciones',
        'Processing files': 'Procesando archivos', 'Writing report': 'Escribiendo informe', 'Complete': 'Completo',
        'Built for the moment after a job starts.': 'Hecho para el momento después de iniciar una tarea.', 'How PingStep works': 'Cómo funciona PingStep',
        'Current stage, not just “running”': 'Etapa actual, no solo “en ejecución”', 'Lost visibility is clear': 'La pérdida de visibilidad es clara', 'Small, safe updates': 'Actualizaciones pequeñas y seguras',
        'Your script reports meaningful stages, so you can see the last progress marker it actually reached.': 'Su script informa etapas importantes para que vea el último marcador de progreso que realmente alcanzó.',
        'When updates stop, PingStep marks the run stale. It does not pretend that silence means healthy.': 'Cuando se detienen las actualizaciones, PingStep marca la ejecución sin actualizaciones. No supone que el silencio significa que todo está bien.',
        'Send lifecycle events over HTTPS. PingStep does not need raw logs, payloads, SQL, credentials, or customer data.': 'Envíe eventos de ciclo de vida mediante HTTPS. PingStep no necesita registros sin procesar, cargas útiles, SQL, credenciales ni datos de clientes.',
        'Create a job': 'Crear una tarea', 'Send events': 'Enviar eventos', 'See the last known state': 'Ver el último estado conocido',
        'Give it a simple, non-sensitive name and choose how often it normally reports an update.': 'Déle un nombre simple y no confidencial, y elija cada cuánto suele informar una actualización.',
        'Your script sends a start event, useful stages as it works, and a clear success or failure at the end.': 'Su script envía un evento de inicio, etapas útiles mientras trabaja y un éxito o error claro al final.',
        'Open PingStep to see the latest reported stage. If updates stop, it becomes stale.': 'Abra PingStep para ver la última etapa informada. Si las actualizaciones se detienen, queda sin actualizaciones.',
        'Status means one clear thing.': 'Cada estado tiene un significado claro.', 'Stop guessing whether a job is still moving.': 'Deje de adivinar si una tarea sigue avanzando.',
        'PingStep reports what it has received. It does not guess whether a silent job is healthy.': 'PingStep informa lo que ha recibido. No adivina si una tarea silenciosa está en buen estado.',
        'Recent updates are arriving. The last reported stage is shown.': 'Llegan actualizaciones recientes. Se muestra la última etapa informada.',
        'Updates stopped past the time you set. The job may still be running, but PingStep cannot confirm it.': 'Las actualizaciones se detuvieron después del tiempo que configuró. La tarea puede seguir ejecutándose, pero PingStep no puede confirmarlo.',
        'Your script explicitly sent a successful completion event.': 'Su script envió explícitamente un evento de finalización exitosa.', 'Your script explicitly sent a failed completion event. It is never shown as complete.': 'Su script envió explícitamente un evento de error. Nunca se muestra como completo.',
        'Only the signal you choose.': 'Solo la señal que usted elige.', 'Never your job’s contents.': 'Nunca el contenido de su tarea.',
        'Start monitoring your jobs': 'Empiece a monitorear sus tareas', 'Continue with GitHub': 'Continuar con GitHub', 'Your jobs': 'Sus tareas', 'Sign out': 'Cerrar sesión',
        'Your first run in four steps': 'Su primera ejecución en cuatro pasos', 'Create a job': 'Crear una tarea', 'Copy its token': 'Copiar su token', 'Send an event': 'Enviar un evento', 'See the run here': 'Ver la ejecución aquí',
        'Job key': 'Clave de tarea', 'Expected update interval (seconds)': 'Intervalo esperado de actualización (segundos)', 'Liveness grace (seconds)': 'Margen de actividad (segundos)',
        'Copy token': 'Copiar token', 'Copied': 'Copiado', 'Runs': 'Ejecuciones', 'Run status': 'Estado', 'Last reported stage': 'Última etapa informada', 'Last update': 'Última actualización',
        'No jobs yet': 'Aún no hay tareas', 'No stage reported yet': 'Aún no hay etapa informada', 'Language': 'Idioma', 'Pricing': 'Precios', 'Docs': 'Documentación', 'Security': 'Seguridad', 'Privacy': 'Privacidad', 'Terms': 'Términos', 'Contact': 'Contacto', 'Status': 'Estado'
      }
    },
    'pt-BR': {
      name: 'Português (Brasil)',
      messages: {
        'Open dashboard': 'Abrir painel', 'Progress-aware monitoring': 'Monitoramento com progresso', 'See where your job is.': 'Veja onde está o seu trabalho.',
        'PingStep shows the last stage your job reached and makes lost visibility clear, so you do not have to keep checking logs or guessing.': 'O PingStep mostra a última etapa que seu trabalho alcançou e deixa clara a perda de visibilidade, para que você não precise verificar logs ou adivinhar.',
        'Send a few small lifecycle events. Keep your logs and job data where they already are.': 'Envie alguns pequenos eventos de ciclo de vida. Mantenha seus logs e dados onde já estão.',
        'Monitor a job': 'Monitorar um trabalho', 'What you see': 'O que você vê', 'Running': 'Em execução', 'Succeeded': 'Concluído', 'Failed': 'Com falha', 'Stale': 'Sem atualizações',
        'Processing files': 'Processando arquivos', 'Writing report': 'Gerando relatório', 'Complete': 'Concluído',
        'Built for the moment after a job starts.': 'Feito para o momento após o início de um trabalho.', 'How PingStep works': 'Como o PingStep funciona',
        'Current stage, not just “running”': 'Etapa atual, não apenas “em execução”', 'Lost visibility is clear': 'A perda de visibilidade fica clara', 'Small, safe updates': 'Atualizações pequenas e seguras',
        'Your script reports meaningful stages, so you can see the last progress marker it actually reached.': 'Seu script informa etapas relevantes para que você veja o último marco de progresso que ele realmente alcançou.',
        'When updates stop, PingStep marks the run stale. It does not pretend that silence means healthy.': 'Quando as atualizações param, o PingStep marca a execução como sem atualizações. Ele não finge que silêncio significa que está tudo bem.',
        'Send lifecycle events over HTTPS. PingStep does not need raw logs, payloads, SQL, credentials, or customer data.': 'Envie eventos de ciclo de vida por HTTPS. O PingStep não precisa de logs brutos, cargas, SQL, credenciais ou dados de clientes.',
        'Create a job': 'Criar um trabalho', 'Send events': 'Enviar eventos', 'See the last known state': 'Ver o último estado conhecido',
        'Give it a simple, non-sensitive name and choose how often it normally reports an update.': 'Dê um nome simples e não confidencial e escolha com que frequência ele normalmente informa uma atualização.',
        'Your script sends a start event, useful stages as it works, and a clear success or failure at the end.': 'Seu script envia um evento de início, etapas úteis enquanto trabalha e um sucesso ou falha claro ao final.',
        'Open PingStep to see the latest reported stage. If updates stop, it becomes stale.': 'Abra o PingStep para ver a última etapa informada. Se as atualizações pararem, ele ficará sem atualizações.',
        'Status means one clear thing.': 'Cada status tem um significado claro.', 'Stop guessing whether a job is still moving.': 'Pare de adivinhar se um trabalho ainda está avançando.',
        'PingStep reports what it has received. It does not guess whether a silent job is healthy.': 'O PingStep informa o que recebeu. Ele não adivinha se um trabalho silencioso está saudável.',
        'Recent updates are arriving. The last reported stage is shown.': 'Atualizações recentes estão chegando. A última etapa informada é exibida.',
        'Updates stopped past the time you set. The job may still be running, but PingStep cannot confirm it.': 'As atualizações pararam depois do tempo definido. O trabalho ainda pode estar em execução, mas o PingStep não consegue confirmá-lo.',
        'Your script explicitly sent a successful completion event.': 'Seu script enviou explicitamente um evento de conclusão bem-sucedida.', 'Your script explicitly sent a failed completion event. It is never shown as complete.': 'Seu script enviou explicitamente um evento de falha. Ele nunca é mostrado como concluído.',
        'Only the signal you choose.': 'Somente o sinal que você escolhe.', 'Never your job’s contents.': 'Nunca o conteúdo do seu trabalho.',
        'Start monitoring your jobs': 'Comece a monitorar seus trabalhos', 'Continue with GitHub': 'Continuar com GitHub', 'Your jobs': 'Seus trabalhos', 'Sign out': 'Sair',
        'Your first run in four steps': 'Sua primeira execução em quatro passos', 'Create a job': 'Criar um trabalho', 'Copy its token': 'Copiar seu token', 'Send an event': 'Enviar um evento', 'See the run here': 'Ver a execução aqui',
        'Job key': 'Chave do trabalho', 'Expected update interval (seconds)': 'Intervalo esperado de atualização (segundos)', 'Liveness grace (seconds)': 'Margem de atividade (segundos)',
        'Copy token': 'Copiar token', 'Copied': 'Copiado', 'Runs': 'Execuções', 'Run status': 'Status da execução', 'Last reported stage': 'Última etapa informada', 'Last update': 'Última atualização',
        'No jobs yet': 'Ainda não há trabalhos', 'No stage reported yet': 'Nenhuma etapa informada ainda', 'Language': 'Idioma', 'Pricing': 'Preços', 'Docs': 'Documentação', 'Security': 'Segurança', 'Privacy': 'Privacidade', 'Terms': 'Termos', 'Contact': 'Contato', 'Status': 'Status'
      }
    },
    de: {
      name: 'Deutsch',
      messages: {
        'Open dashboard': 'Dashboard öffnen', 'Progress-aware monitoring': 'Fortschrittsorientierte Überwachung', 'See where your job is.': 'Sehen Sie, wo Ihr Job steht.',
        'PingStep shows the last stage your job reached and makes lost visibility clear, so you do not have to keep checking logs or guessing.': 'PingStep zeigt die letzte erreichte Phase Ihres Jobs und macht fehlende Sichtbarkeit klar, damit Sie keine Protokolle prüfen oder raten müssen.',
        'Send a few small lifecycle events. Keep your logs and job data where they already are.': 'Senden Sie wenige kleine Lebenszyklusereignisse. Ihre Protokolle und Jobdaten bleiben, wo sie bereits sind.',
        'Monitor a job': 'Job überwachen', 'What you see': 'Was Sie sehen', 'Running': 'Läuft', 'Succeeded': 'Erfolgreich', 'Failed': 'Fehlgeschlagen', 'Stale': 'Keine Updates',
        'Processing files': 'Dateien werden verarbeitet', 'Writing report': 'Bericht wird geschrieben', 'Complete': 'Abgeschlossen',
        'Built for the moment after a job starts.': 'Für den Moment nach dem Start eines Jobs.', 'How PingStep works': 'So funktioniert PingStep',
        'Current stage, not just “running”': 'Aktuelle Phase, nicht nur „läuft“', 'Lost visibility is clear': 'Fehlende Sichtbarkeit ist klar', 'Small, safe updates': 'Kleine, sichere Updates',
        'Your script reports meaningful stages, so you can see the last progress marker it actually reached.': 'Ihr Skript meldet aussagekräftige Phasen, sodass Sie den letzten tatsächlich erreichten Fortschrittsmarker sehen.',
        'When updates stop, PingStep marks the run stale. It does not pretend that silence means healthy.': 'Wenn Updates ausbleiben, markiert PingStep den Lauf als ohne Updates. Stille wird nicht als gesund ausgegeben.',
        'Send lifecycle events over HTTPS. PingStep does not need raw logs, payloads, SQL, credentials, or customer data.': 'Senden Sie Lebenszyklusereignisse über HTTPS. PingStep benötigt keine Rohprotokolle, Nutzdaten, SQL, Anmeldedaten oder Kundendaten.',
        'Create a job': 'Job erstellen', 'Send events': 'Ereignisse senden', 'See the last known state': 'Letzten bekannten Zustand sehen',
        'Give it a simple, non-sensitive name and choose how often it normally reports an update.': 'Geben Sie ihm einen einfachen, nicht vertraulichen Namen und wählen Sie, wie oft er normalerweise ein Update meldet.',
        'Your script sends a start event, useful stages as it works, and a clear success or failure at the end.': 'Ihr Skript sendet ein Startereignis, nützliche Phasen während der Arbeit und am Ende ein klares Erfolg- oder Fehlerereignis.',
        'Open PingStep to see the latest reported stage. If updates stop, it becomes stale.': 'Öffnen Sie PingStep, um die zuletzt gemeldete Phase zu sehen. Wenn Updates ausbleiben, ist der Lauf ohne Updates.',
        'Status means one clear thing.': 'Jeder Status hat eine klare Bedeutung.', 'Stop guessing whether a job is still moving.': 'Raten Sie nicht länger, ob ein Job noch fortschreitet.',
        'PingStep reports what it has received. It does not guess whether a silent job is healthy.': 'PingStep meldet, was es empfangen hat. Es rät nicht, ob ein stiller Job gesund ist.',
        'Recent updates are arriving. The last reported stage is shown.': 'Aktuelle Updates treffen ein. Die zuletzt gemeldete Phase wird angezeigt.',
        'Updates stopped past the time you set. The job may still be running, but PingStep cannot confirm it.': 'Updates blieben länger aus als von Ihnen festgelegt. Der Job läuft möglicherweise noch, aber PingStep kann es nicht bestätigen.',
        'Your script explicitly sent a successful completion event.': 'Ihr Skript hat ausdrücklich ein erfolgreiches Abschlussereignis gesendet.', 'Your script explicitly sent a failed completion event. It is never shown as complete.': 'Ihr Skript hat ausdrücklich ein Fehlerereignis gesendet. Es wird niemals als abgeschlossen angezeigt.',
        'Only the signal you choose.': 'Nur das Signal, das Sie wählen.', 'Never your job’s contents.': 'Nie der Inhalt Ihres Jobs.',
        'Start monitoring your jobs': 'Beginnen Sie mit der Überwachung Ihrer Jobs', 'Continue with GitHub': 'Mit GitHub fortfahren', 'Your jobs': 'Ihre Jobs', 'Sign out': 'Abmelden',
        'Your first run in four steps': 'Ihr erster Lauf in vier Schritten', 'Create a job': 'Job erstellen', 'Copy its token': 'Token kopieren', 'Send an event': 'Ereignis senden', 'See the run here': 'Lauf hier ansehen',
        'Job key': 'Job-Schlüssel', 'Expected update interval (seconds)': 'Erwartetes Aktualisierungsintervall (Sekunden)', 'Liveness grace (seconds)': 'Aktivitäts-Puffer (Sekunden)',
        'Copy token': 'Token kopieren', 'Copied': 'Kopiert', 'Runs': 'Läufe', 'Run status': 'Laufstatus', 'Last reported stage': 'Zuletzt gemeldete Phase', 'Last update': 'Letzte Aktualisierung',
        'No jobs yet': 'Noch keine Jobs', 'No stage reported yet': 'Noch keine Phase gemeldet', 'Language': 'Sprache', 'Pricing': 'Preise', 'Docs': 'Dokumentation', 'Security': 'Sicherheit', 'Privacy': 'Datenschutz', 'Terms': 'Nutzungsbedingungen', 'Contact': 'Kontakt', 'Status': 'Status'
      }
    }
  };

  const key = 'pingstep-language';
  const current = () => languages[localStorage.getItem(key)] ? localStorage.getItem(key) : 'en';
  const translate = (value) => languages[current()].messages[value] || value;

  function translateTextNodes() {
    if (current() === 'en') return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest('script,style,pre,code')) continue;
      const source = node.nodeValue || '';
      const match = source.match(/^(\s*)(.*?)(\s*)$/s);
      if (!match) continue;
      const translated = translate(match[2]);
      if (translated !== match[2]) node.nodeValue = `${match[1]}${translated}${match[3]}`;
    }
  }

  function setLanguage(value) {
    const language = languages[value] ? value : 'en';
    localStorage.setItem(key, language);
    location.reload();
  }

  function init() {
    document.documentElement.lang = current();
    const select = document.querySelector('#language');
    if (select) {
      select.value = current();
      select.addEventListener('change', (event) => setLanguage(event.target.value));
      select.setAttribute('aria-label', translate('Language'));
    }
    translateTextNodes();
  }

  window.PingStepI18n = { current, init, setLanguage, t: translate, languages };
})();
