// Languages for the language bridge. `english` is the name sent to the
// translator; `speech` is the code for voice input/output.
export const LANGUAGES = [
  { key: 'en', name: 'English',          english: 'English',          speech: 'en-US', ui: { speak: 'Speak',  you: 'You',   phrases: 'Tap a phrase to show and say it in English', type: 'Or type here', rights: 'Your rights' } },
  { key: 'es', name: 'Español',          english: 'Spanish',          speech: 'es-US', ui: { speak: 'Hablar', you: 'Usted', phrases: 'Toque una frase para mostrársela al oficial', type: 'O escriba aquí', rights: 'Sus derechos' } },
  { key: 'zh', name: '中文',              english: 'Chinese (Simplified)', speech: 'zh-CN', ui: { speak: '说话', you: '您', phrases: '点击一句话给警察看', type: '或在这里输入', rights: '您的权利' } },
  { key: 'vi', name: 'Tiếng Việt',       english: 'Vietnamese',       speech: 'vi-VN', ui: { speak: 'Nói', you: 'Bạn', phrases: 'Chạm vào một câu để cho cảnh sát xem', type: 'Hoặc gõ vào đây', rights: 'Quyền của bạn' } },
  { key: 'ko', name: '한국어',            english: 'Korean',           speech: 'ko-KR', ui: { speak: '말하기', you: '나', phrases: '문장을 눌러 경찰관에게 보여 주세요', type: '또는 여기에 입력하세요', rights: '나의 권리' } },
  { key: 'ar', name: 'العربية',          english: 'Arabic',           speech: 'ar-SA', dir: 'rtl', ui: { speak: 'تكلّم', you: 'أنت', phrases: 'اضغط على عبارة لعرضها على الشرطي', type: 'أو اكتب هنا', rights: 'حقوقك' } },
  { key: 'ht', name: 'Kreyòl ayisyen',   english: 'Haitian Creole',   speech: 'ht-HT', ui: { speak: 'Pale', you: 'Ou', phrases: 'Tape yon fraz pou montre polisye a', type: 'Oswa ekri isit la', rights: 'Dwa ou' } },
  { key: 'pt', name: 'Português',        english: 'Portuguese',       speech: 'pt-BR', ui: { speak: 'Falar', you: 'Você', phrases: 'Toque numa frase para mostrá-la ao policial', type: 'Ou digite aqui', rights: 'Seus direitos' } },
  { key: 'fr', name: 'Français',         english: 'French',           speech: 'fr-FR', ui: { speak: 'Parler', you: 'Vous', phrases: 'Touchez une phrase pour la montrer à l’agent', type: 'Ou écrivez ici', rights: 'Vos droits' } },
  { key: 'hi', name: 'हिन्दी',            english: 'Hindi',            speech: 'hi-IN', ui: { speak: 'बोलें', you: 'आप', phrases: 'पुलिस अधिकारी को दिखाने के लिए किसी वाक्य पर टैप करें', type: 'या यहाँ लिखें', rights: 'आपके अधिकार' } },
];

export const ENGLISH = LANGUAGES[0];
export const getLang = (key) => LANGUAGES.find((l) => l.key === key) || ENGLISH;

// Offline phrase cards: the person taps their language, the screen shows and speaks English.
export const PHRASES = [
  {
    en: 'I don’t speak English well. I need an interpreter.',
    es: 'No hablo bien inglés. Necesito un intérprete.',
    zh: '我英语不好。我需要翻译。',
    vi: 'Tôi không nói tiếng Anh giỏi. Tôi cần thông dịch viên.',
    ko: '저는 영어를 잘 못합니다. 통역사가 필요합니다.',
    ar: 'لا أتكلم الإنجليزية جيدًا. أحتاج إلى مترجم.',
    ht: 'Mwen pa pale angle byen. Mwen bezwen yon entèprèt.',
    pt: 'Não falo inglês bem. Preciso de um intérprete.',
    fr: 'Je ne parle pas bien anglais. J’ai besoin d’un interprète.',
    hi: 'मैं अंग्रेज़ी अच्छी तरह नहीं बोलता। मुझे दुभाषिया चाहिए।',
  },
  {
    en: 'I am hurt. Please call an ambulance.',
    es: 'Estoy herido. Por favor, llame a una ambulancia.',
    zh: '我受伤了。请叫救护车。',
    vi: 'Tôi bị thương. Xin hãy gọi xe cứu thương.',
    ko: '다쳤어요. 구급차를 불러 주세요.',
    ar: 'أنا مصاب. من فضلك اتصل بسيارة إسعاف.',
    ht: 'Mwen blese. Tanpri rele yon anbilans.',
    pt: 'Estou ferido. Por favor, chame uma ambulância.',
    fr: 'Je suis blessé. Appelez une ambulance, s’il vous plaît.',
    hi: 'मुझे चोट लगी है। कृपया एम्बुलेंस बुलाइए।',
  },
  {
    en: 'I am not hurt.',
    es: 'No estoy herido.',
    zh: '我没有受伤。',
    vi: 'Tôi không bị thương.',
    ko: '저는 다치지 않았습니다.',
    ar: 'أنا لست مصابًا.',
    ht: 'Mwen pa blese.',
    pt: 'Não estou ferido.',
    fr: 'Je ne suis pas blessé.',
    hi: 'मुझे चोट नहीं लगी है।',
  },
  {
    en: 'A car hit me.',
    es: 'Un carro me golpeó.',
    zh: '一辆车撞了我。',
    vi: 'Một chiếc xe hơi đã đâm vào tôi.',
    ko: '차가 저를 쳤어요.',
    ar: 'صدمتني سيارة.',
    ht: 'Yon machin frape m.',
    pt: 'Um carro me atingiu.',
    fr: 'Une voiture m’a percuté.',
    hi: 'एक कार ने मुझे टक्कर मारी।',
  },
  {
    en: 'Here is my driver’s license, registration, and insurance.',
    es: 'Aquí está mi licencia de conducir, registro y seguro.',
    zh: '这是我的驾照、车辆登记和保险。',
    vi: 'Đây là bằng lái xe, giấy đăng ký xe và bảo hiểm của tôi.',
    ko: '제 운전면허증, 차량 등록증, 보험증입니다.',
    ar: 'هذه رخصة القيادة وتسجيل السيارة والتأمين الخاص بي.',
    ht: 'Men lisans mwen, papye machin nan ak asirans mwen.',
    pt: 'Aqui está minha carteira de motorista, documento do veículo e seguro.',
    fr: 'Voici mon permis de conduire, ma carte grise et mon assurance.',
    hi: 'यह मेरा ड्राइविंग लाइसेंस, रजिस्ट्रेशन और बीमा है।',
  },
  {
    en: 'Please write down your name, badge number, and the report number.',
    es: 'Por favor, escriba su nombre, número de placa y número de reporte.',
    zh: '请写下您的姓名、警号和报告编号。',
    vi: 'Xin hãy ghi tên, số hiệu và số biên bản của anh/chị.',
    ko: '성함, 배지 번호, 사고 보고서 번호를 적어 주세요.',
    ar: 'من فضلك اكتب اسمك ورقم شارتك ورقم التقرير.',
    ht: 'Tanpri ekri non ou, nimewo badj ou ak nimewo rapò a.',
    pt: 'Por favor, escreva seu nome, número do distintivo e número do boletim.',
    fr: 'Veuillez écrire votre nom, votre numéro de badge et le numéro du rapport.',
    hi: 'कृपया अपना नाम, बैज नंबर और रिपोर्ट नंबर लिख दीजिए।',
  },
  {
    en: 'I don’t understand. Please speak slowly.',
    es: 'No entiendo. Por favor, hable despacio.',
    zh: '我听不懂。请说慢一点。',
    vi: 'Tôi không hiểu. Xin hãy nói chậm lại.',
    ko: '이해하지 못했습니다. 천천히 말씀해 주세요.',
    ar: 'لا أفهم. من فضلك تكلم ببطء.',
    ht: 'Mwen pa konprann. Tanpri pale dousman.',
    pt: 'Não entendo. Por favor, fale devagar.',
    fr: 'Je ne comprends pas. Parlez lentement, s’il vous plaît.',
    hi: 'मैं समझ नहीं पाया। कृपया धीरे बोलिए।',
  },
];

// General information, translated live when online.
export const RIGHTS_EN = [
  'You must stop and share your name, address, license, registration, and insurance with the other person and the police.',
  'You can ask for an interpreter. It is OK to say you don’t understand a question.',
  'Stick to facts. You don’t have to say who was at fault or guess how fast anyone was going.',
  'Ask for the officer’s name, badge number, and the police report number.',
  'If you were walking, biking, or riding a scooter, the driver must stop and share their information with you too.',
  'You can talk to a lawyer before giving a recorded statement to any insurance company. Many offer free consultations.',
];
export const RIGHTS_NOTE = 'General information, not legal advice. Rules vary by state.';
