import type { Dictionary } from './en';

export const ru: Dictionary = {
  'plugin.name': 'Vault Telegram Bridge',

  'conn.status.disconnected': 'Не подключено',
  'conn.status.connecting': 'Подключение…',
  'conn.status.connected': 'Подключено как @{name}',
  'conn.status.authRequired': 'Токен бота отсутствует или недействителен',

  'settings.token.name': 'Токен бота',
  'settings.token.desc':
    'Создайте бота через @BotFather в Telegram и вставьте токен сюда. Токен хранится в data.json этого плагина внутри папки конфигурации Obsidian.',
  'settings.token.placeholder': '123456789:AA…',
  'settings.token.connect': 'Подключить',
  'settings.token.connected': 'Подключено к @{name}',
  'settings.disconnect.name': 'Отключиться и удалить токен',
  'settings.disconnect.desc':
    'Удаляет токен из этого хранилища. Чтобы отключить бота везде, также отправьте /revoke боту @BotFather.',
  'settings.disconnect.button': 'Отключить',
  'settings.disconnect.done': 'Токен удалён. Если бот больше не нужен, отзовите его через @BotFather.',
  'settings.boundChat.name': 'Привязанный чат',
  'settings.boundChat.desc':
    'Первый написавший боту чат привязывается к плагину, сообщения из остальных чатов игнорируются.',
  'settings.boundChat.none': 'Чат ещё не привязан — отправьте сообщение своему боту.',
  'settings.boundChat.bound': 'Привязан чат {chatId}',
  'settings.boundChat.reset': 'Отвязать',
  'settings.boundChat.resetDone': 'Чат отвязан. Следующий написавший боту чат будет привязан.',

  'settings.section.destination': 'Куда сохранять сообщения',
  'settings.coreDaily.name': 'Использовать встроенные ежедневные заметки',
  'settings.coreDaily.desc':
    'Записывать в заметку встроенного плагина «Ежедневные заметки», используя его папку, имя и шаблон. Заголовок ниже применяется в любом режиме.',
  'settings.coreDaily.unavailable':
    'Встроенный плагин «Ежедневные заметки» отключён, поэтому временно используются папка и имя ниже.',
  'settings.folder.name': 'Папка',
  'settings.folder.desc': 'Оставьте пустой для корня хранилища.',
  'settings.folder.placeholder': 'Входящие/Telegram',
  'settings.filename.name': 'Имя заметки',
  'settings.filename.desc': 'Формат даты для имени заметки. Поддерживает токены Moment.js. Пример: {preview}',
  'settings.filename.placeholder': 'YYYY-MM-DD',
  'settings.heading.name': 'Заголовок',
  'settings.heading.desc': 'Сообщения добавляются под этот заголовок; если его нет, он будет создан.',

  'settings.section.routes': 'Маршруты по хэштегам',
  'settings.routes.desc':
    'Отправляйте #idea или другой хэштег Telegram в отдельную заметку. Правила проверяются сверху вниз, совпавший хэштег удаляется из записи.',
  'settings.routes.tag.placeholder': 'idea',
  'settings.routes.path.placeholder': 'Входящие/Идеи.md',
  'settings.routes.heading.placeholder': '## Идеи (необязательно)',
  'settings.routes.add': 'Добавить маршрут',
  'settings.routes.remove': 'Удалить маршрут',

  'settings.section.format': 'Формат сообщения',
  'settings.template.name': 'Формат строки',
  'settings.template.desc':
    '{time}, {date} и {text} заменяются значениями. Остальное записывается как есть — здесь можно добавить эмодзи, Markdown или маркер списка.',
  'settings.template.placeholder': '✏️ **{time}** {text}',
  'settings.blockStyle.name': 'Оформлять каждое сообщение как',
  'settings.blockStyle.plain': 'Обычный текст',
  'settings.blockStyle.code': 'Блок кода',
  'settings.blockStyle.callout': 'Выноску',
  'settings.blockStyle.codeWarning':
    'В блоке кода Markdown не обрабатывается. Используйте выноску, если нужно сохранить форматирование в рамке.',
  'settings.calloutType.name': 'Тип выноски',
  'settings.calloutType.desc': 'note, tip, quote, info, warning — любое значение, поддерживаемое Obsidian после [!…].',
  'settings.preview.name': 'Предпросмотр',

  'settings.section.transcription': 'Расшифровка голоса',
  'settings.transcription.name': 'Расшифровывать голосовые сообщения',
  'settings.transcription.desc':
    'Отправлять voice, audio и видеосообщения в OpenAI-совместимый сервис распознавания речи. По умолчанию выключено.',
  'settings.transcription.baseUrl.name': 'Базовый URL API',
  'settings.transcription.baseUrl.desc': 'Плагин вызывает /audio/transcriptions относительно этого адреса.',
  'settings.transcription.apiKey.name': 'Ключ API',
  'settings.transcription.apiKey.desc':
    'Хранится в data.json этого плагина внутри папки конфигурации Obsidian, как и токен Telegram-бота.',
  'settings.transcription.apiKey.placeholder': 'sk-…',
  'settings.transcription.model.name': 'Модель',
  'settings.transcription.model.desc': 'Например whisper-1 или название модели из документации вашего провайдера.',
  'settings.transcription.hint.groq':
    'Groq (бесплатный тариф): базовый URL https://api.groq.com/openai/v1, модель whisper-large-v3, ключ на console.groq.com/keys.',
  'settings.transcription.hint.openai':
    'OpenAI: базовый URL https://api.openai.com/v1, модель whisper-1, ключ на platform.openai.com/api-keys.',
  'settings.transcription.test.name': 'Проверить подключение',
  'settings.transcription.test.desc':
    'Отправляет долю секунды тишины, чтобы проверить URL, ключ и модель.',
  'settings.transcription.test.button': 'Проверить',
  'settings.transcription.test.ok': 'Расшифровка работает.',

  'settings.section.sync': 'Синхронизация',
  'settings.interval.name': 'Проверять каждые',
  'settings.interval.desc': 'Telegram проверяется, только пока Obsidian открыт.',
  'settings.interval.seconds': '{n} сек.',
  'settings.interval.minutes': '{n} мин.',
  'settings.syncNow.name': 'Синхронизировать сейчас',
  'settings.syncNow.button': 'Синхронизировать',
  'settings.status.name': 'Последняя синхронизация',
  'settings.status.never': 'Никогда',
  'settings.status.ok': '{time} — новых: {n}',
  'settings.status.okNothing': '{time} — новых сообщений нет',
  'settings.status.running': 'Выполняется…',
  'settings.status.error': '{time} — ошибка: {message}',

  'command.syncNow': 'Синхронизировать сейчас',
  'entry.attachmentTooBig': '*Вложение больше 20 МБ — Bot API не может его скачать; файл остаётся в Telegram.*',
  'entry.attachmentFailed': '*Не удалось скачать вложение — оно остаётся в Telegram.*',
  'entry.transcription': '🎙️ {text}',
  'notice.synced': 'Telegram: новых записей — {n}',
  'notice.skipped.nonText': 'Пропущено неподдерживаемых сообщений: {n}.',
  'notice.skipped.foreignChat': 'Сообщений из непривязанного чата проигнорировано: {n}.',
  'notice.bound': 'Бот привязан к этому чату. Сообщения из других чатов будут игнорироваться.',

  'error.noToken': 'Сначала добавьте токен бота в настройках плагина.',
  'error.invalidToken': 'Telegram отклонил токен. Проверьте его через @BotFather или создайте нового бота.',
  'error.tokenShape': 'Токен должен состоять из номера, двоеточия и примерно 35 символов после него.',
  'error.network': 'Не удалось подключиться к Telegram. Проверьте интернет-соединение.',
  'error.offline': 'Нет подключения к интернету — повторим при следующей проверке.',
  'error.conflict':
    'Другой девайс уже опрашивает этого бота. Это нормально: заметка попадёт на остальные устройства через синхронизацию хранилища.',
  'error.rateLimited': 'Telegram ограничил частоту запросов. Ожидание: {seconds} сек.',
  'error.telegram': 'Ответ Telegram: {message}',
  'error.fileTooBig': 'Telegram не позволяет ботам скачивать файлы больше 20 МБ.',
  'error.badFolder': 'Не удалось использовать папку «{folder}»: {reason}',
  'error.badTemplate': 'Шаблон имени заметки «{template}» создаёт пустое или недопустимое имя.',
  'error.noTextPlaceholder': 'В формате строки нет {text}, поэтому текст сообщения будет потерян.',
  'error.writeFailed': 'Не удалось записать в «{path}»: {reason}',
  'error.transcriptionFailed': 'Не удалось расшифровать голос ({reason}). Вложение всё равно сохранено.',
  'error.unknown': 'Произошла ошибка: {message}',
};
