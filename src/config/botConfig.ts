import fs from 'fs';
import path from 'path';

// Estrutura de cada funcionalidade
export interface BotFeature {
    id: string;
    title: string;
    description: string;
    category: string;
    enabled: boolean;
}

// Arquivo de persistência local para não precisarmos de banco de dados imediatamente para os toggles
const CONFIG_FILE = path.join(__dirname, '../../bot_features.json');

// Definição das 110+ Funcionalidades
const DEFAULT_FEATURES: BotFeature[] = [
    { id: 'f1', title: 'Memória de Longo Prazo', description: 'A IA lembrar de orações passadas.', category: 'Inteligência e Contexto', enabled: true },
    { id: 'f2', title: 'Análise de Sentimento', description: 'Se um pedido de oração for de angústia grave, disparar "alerta vermelho".', category: 'Inteligência e Contexto', enabled: true },
    { id: 'f3', title: 'Sugestão Musical', description: 'Geração de louvores baseados no contexto da dor do usuário.', category: 'Inteligência e Contexto', enabled: false },
    { id: 'f4', title: 'Gerador de Bom Dia', description: 'Gera artes com Paleta da igreja via IA.', category: 'Inteligência e Contexto', enabled: false },
    { id: 'f5', title: 'Classificador de Frequência', description: 'Detecção de sumiço de 3 semanas.', category: 'Inteligência e Contexto', enabled: false },
    { id: 'f6', title: 'Agente de Discipulado', description: 'Novatos recebem minilições automáticas.', category: 'Inteligência e Contexto', enabled: false },
    { id: 'f7', title: 'RAG Bíblico', description: 'Consulta de dúvidas pautadas nos próprios esboços do Pastor.', category: 'Inteligência e Contexto', enabled: false },
    { id: 'f8', title: 'IA Emocional TTS', description: 'Ajuste de entonação (Séria para dor, Animada para parabéns).', category: 'Inteligência e Contexto', enabled: false },
    { id: 'f9', title: 'Aconselhamento Financeiro', description: 'Skill de mordomia baseado em Provérbios.', category: 'Inteligência e Contexto', enabled: false },
    { id: 'f10', title: 'Resumo Pós-Culto', description: 'Revisão de anotações do sermão via IA usando o comando !resumo.', category: 'Inteligência e Contexto', enabled: false },

    { id: 'f11', title: 'Follow-up de Milagres', description: 'Dias após o !oração, bot pergunta se Deus já respondeu.', category: 'Engajamento', enabled: false },
    { id: 'f12', title: 'Boas-Vindas Pioneiros', description: 'Segunda-feira, mensagem para o 1º Check-in GPS.', category: 'Engajamento', enabled: true },
    { id: 'f13', title: 'Aniversário de Casamento/Batismo', description: 'Bot comemora essas datas cruciais.', category: 'Engajamento', enabled: false },
    { id: 'f14', title: 'Pesquisas de Clima (Lives)', description: 'Pesquisa rápida assíncrona pós-célula.', category: 'Engajamento', enabled: false },
    { id: 'f15', title: 'Gamificação & Recompensas', description: 'XP por responder o Quiz Bíblico.', category: 'Engajamento', enabled: true },
    { id: 'f16', title: 'Escala Interativa', description: 'Aceitar escala com botões [Sim] [Não].', category: 'Engajamento', enabled: false },
    { id: 'f17', title: 'Plano de Leitura Coletivo', description: 'Grupo virtual da Bíblia gerenciado pelo Bot.', category: 'Engajamento', enabled: false },
    { id: 'f18', title: 'Cálculo de Rotas Maps', description: 'Envio de rota exata até a célula.', category: 'Engajamento', enabled: true },
    { id: 'f19', title: 'Formatador de Testemunhos', description: 'Ajuste ortográfico de testemunhos para o telão.', category: 'Engajamento', enabled: false },
    { id: 'f20', title: 'Pipeline de Voluntários', description: 'Pipeline de habilidades (Meu dom é violão).', category: 'Engajamento', enabled: false },

    { id: 'f21', title: 'OCR de Ofertas (PIX)', description: 'Extrator de valor de foto enviada.', category: 'Gestão Pastoral', enabled: false },
    { id: 'f22', title: 'Auditoria de Liderança', description: 'Mede respostas rápidas dos líderes.', category: 'Gestão Pastoral', enabled: false },
    { id: 'f23', title: 'Check-list Manutenção', description: 'Bot coleta tags #quebrado.', category: 'Gestão Pastoral', enabled: false },
    { id: 'f24', title: 'Avisos Em Massa (Test Drive)', description: 'Pastor testa disparo nele mesmo antes de enviar.', category: 'Gestão Pastoral', enabled: true },
    { id: 'f25', title: 'Alarme Consolidador Local', description: 'Bot cobra o líder se ele não chamar os visitantes.', category: 'Gestão Pastoral', enabled: false },
    { id: 'f26', title: 'PDF Dominical', description: 'Relatório macro automático na segunda.', category: 'Gestão Pastoral', enabled: true },
    { id: 'f27', title: 'Gestão via Google Calendar', description: 'Bot agenda aconselhamentos e reuniões.', category: 'Gestão Pastoral', enabled: false },
    { id: 'f28', title: 'Análise Frequência Familiar', description: 'Avisa se o marido falta e a esposa vem freq.', category: 'Gestão Pastoral', enabled: false },
    { id: 'f29', title: 'Moderação Antibarbárie', description: 'Detecta brigas nos grupos e alerta líder.', category: 'Gestão Pastoral', enabled: false },
    { id: 'f30', title: 'Curva Dízimos vs Freq.', description: 'Estatística e cruzamento de dados.', category: 'Gestão Pastoral', enabled: false },

    { id: 'f31', title: 'Bot Cobrador Inscrições', description: 'Lembrete automático para quem deve retiro.', category: 'Extras', enabled: false },
    { id: 'f32', title: 'Check-in via QRCODE Foyer', description: 'QR Code rotativo para check-in por quem não tem GPS.', category: 'Extras', enabled: false },
    { id: 'f33', title: 'Job Church (Empregabilidade)', description: 'Cruza busca por serviços (pintor, pedreiro).', category: 'Extras', enabled: false },
    { id: 'f34', title: 'Podcast On-The-Go', description: 'Grava/recorta sermão do Youtube p/ o zap.', category: 'Extras', enabled: false },
    { id: 'f35', title: 'Role-play Bíblico', description: 'Chat teatralizado ("Fale comigo como Davi").', category: 'Extras', enabled: false },
    { id: 'f36', title: 'Jejum Track & Notificador', description: 'Acorda pra orar de madrugada.', category: 'Extras', enabled: false },
    { id: 'f37', title: 'Transpositor de Escalas', description: 'Transpõe cifras musicais pelo zap.', category: 'Extras', enabled: false },
    { id: 'f38', title: 'Geração de Idiomas On-the-Go', description: 'Tradução em audiodescrição instantânea.', category: 'Extras', enabled: false },
    { id: 'f39', title: 'Check-out Sentimentos', description: 'Mini enquete verde/amarelo/vermelho.', category: 'Extras', enabled: false },

    { id: 'f41', title: 'Criação de Célula Guiada', description: 'Módulo Conversacional p/ pastor abrir nova Célula.', category: 'Config. IA Dinâmica', enabled: true },
    { id: 'f42', title: 'Cancel Express de Célula', description: 'Aviso a todos de cancelamento súbito de célula.', category: 'Config. IA Dinâmica', enabled: false },
    { id: 'f43', title: 'Respostas Rápidas (FAQ)', description: 'Adiciona na FAQ temporária (ex: preço retiro).', category: 'Config. IA Dinâmica', enabled: true },
    { id: 'f44', title: 'SOS Pastoral 24/7', description: 'Alerta vermelho bypassando para o Pr.', category: 'Config. IA Dinâmica', enabled: true },
    { id: 'f45', title: 'Auto-Silêncio (Do Not Disturb)', description: 'Pastor manda \'silenciar bot\' no seu celular.', category: 'Config. IA Dinâmica', enabled: false },
    { id: 'f46', title: 'Mural de Vagas - Ponte', description: 'A IA junta candidatos locais.', category: 'Config. IA Dinâmica', enabled: false },
    { id: 'f47', title: 'Personalidade Maleável', description: 'Troca de tom na hora (ex. Jovem, Sério, Erudito).', category: 'Config. IA Dinâmica', enabled: true },
    { id: 'f48', title: 'Campanha Financeira Tags', description: '#Telhado = joga no painel de doações certo.', category: 'Config. IA Dinâmica', enabled: false },
    { id: 'f49', title: 'Enquetes Seguras', description: 'Via PV de cada obreiro, anonimiza res.', category: 'Config. IA Dinâmica', enabled: false },
    { id: 'f50', title: 'Restrição Luto Família', description: 'Cancel aniversário se tiver tag luto.', category: 'Config. IA Dinâmica', enabled: false },

    { id: 'f51', title: 'Match de Oradores', description: 'Junta 2 irmãos aleatórios para orarem da mesma dor.', category: 'Discipulado Ativo', enabled: false },
    { id: 'f52', title: 'Ideia de Quebra-Gelo Flash', description: 'Bot provê dinamica de Célula na hora do aperto.', category: 'Discipulado Ativo', enabled: true },
    { id: 'f53', title: 'Treino "Pílula Bíblica"', description: 'Drops rapidos em multipla-escolha com quiz.', category: 'Discipulado Ativo', enabled: false },
    { id: 'f54', title: 'Diário Espiritual Anual', description: 'Retrospectiva Spotify da Fé no fim do ano.', category: 'Discipulado Ativo', enabled: false },
    { id: 'f55', title: 'Desafio Memorização Voz', description: 'Transcreve e confere recitação de versículo.', category: 'Discipulado Ativo', enabled: false },
    { id: 'f56', title: 'Formatador Sermão -> PDF', description: 'O Pr digita esboço, a IA revisa PT-BR e cospe PDF.', category: 'Discipulado Ativo', enabled: true },
    { id: 'f57', title: 'Feedback (RLHF Caseiro)', description: 'Bot anota dicas e conserta respostas via "Bot vc errou".', category: 'Discipulado Ativo', enabled: true },
    { id: 'f58', title: 'Moderador Grupo Whatsapp', description: 'Ao ser marcado no grupo, a IA responde pela secretaria.', category: 'Discipulado Ativo', enabled: false },
    { id: 'f59', title: 'Lotado no Kids', description: 'Monitora presenças de crianças e bipa líder.', category: 'Discipulado Ativo', enabled: false },
    { id: 'f60', title: 'Biblioteca de Empréstimos', description: 'Controlar empréstimos de livros via Bot.', category: 'Discipulado Ativo', enabled: false },

    { id: 'f61', title: 'Mapeamento Voluntariado', description: 'Entrevista com 2 perguntas para interessados em servir.', category: 'Integração Igreja', enabled: false },
    { id: 'f62', title: 'Check-in via Selfie Célula', description: 'IA conta o número de cabeças na selfie pós célula.', category: 'Integração Igreja', enabled: false },
    { id: 'f63', title: 'Notificação Nasceu o Bebê!', description: 'Aciona assistência social auto para prato de comida mãe', category: 'Integração Igreja', enabled: false },
    { id: 'f64', title: 'Transferência Bairro (Célula)', description: 'Despede de Célula A, joga p/ Célula B do mapa.', category: 'Integração Igreja', enabled: false },
    { id: 'f65', title: 'Bazar Solidário de Foto', description: 'Pega a foto doada, avalia valor sugerido, posta site.', category: 'Integração Igreja', enabled: false },
    { id: 'f66', title: 'Modo Convidado Anônimo', description: 'Membro que só quer Bíblia sem dar dados (Funil)', category: 'Integração Igreja', enabled: false },
    { id: 'f67', title: 'Pesquisa Flash Retiros', description: 'Manda NPS relâmpago pós-fim-semana fora', category: 'Integração Igreja', enabled: false },
    { id: 'f68', title: 'Sorteio GPS', description: 'Fazer rifa ou sorteio de brindes para quem bateu GPS no culto.', category: 'Integração Igreja', enabled: false },
    { id: 'f69', title: 'Repertório Adoração API', description: 'Sabe o SetList de todas as ultimas semanas.', category: 'Integração Igreja', enabled: false },
    { id: 'f70', title: 'Atualização Endereço (Self Service)', description: 'Bot descobre mudança cep e atualiza Supabase', category: 'Integração Igreja', enabled: false },

    { id: 'f72', title: 'Consolo Pós-Morte', description: 'Devocionais em loop de luto em 10 dias.', category: 'Casos Críticos', enabled: false },
    { id: 'f73', title: 'Cofre Oracional Anônimo', description: '"Pastor do outro lado lê sem ter o numero e nome do membro."', category: 'Casos Críticos', enabled: true },
    { id: 'f74', title: 'Contagem Regressiva Casamento', description: 'Envia avisos faltando dias para grande noivado.', category: 'Casos Críticos', enabled: false },
    { id: 'f75', title: 'Desperta Jovem', description: 'Líder seta IA p telefonar/mandar aúdio as 7 da matina acamp!', category: 'Casos Críticos', enabled: false },
    { id: 'f76', title: 'Mentoria Reversa Connect', description: 'IA une jovens e idosos baseando na taxa de abertuta devoc.', category: 'Casos Críticos', enabled: false },
    { id: 'f77', title: 'Receitas Mulheres Saude', description: 'Mandando cardapios auto no grupo mulher pos culto.', category: 'Casos Críticos', enabled: false },
    { id: 'f78', title: 'Relatório Morno Ano', description: 'Rastrear esfriados no decorrer Q1, Q2, Q3, Q4.', category: 'Casos Críticos', enabled: false },
    { id: 'f79', title: 'Inscrição Batismo Simples', description: 'Criaçao do pdf da roupa do candidato direto no watz', category: 'Casos Críticos', enabled: false },
    { id: 'f80', title: 'Avaliação Anônima Líder', description: 'Voluntário julga o chefe 1 a 5 oculto da vista dele.', category: 'Casos Críticos', enabled: false },
    { id: 'f81', title: 'Testamento Fé (Histórico Master)', description: 'Registra a jornada espiriritual inteira forever.', category: 'Casos Críticos', enabled: false },

    // NOVAS CATEGORIAS (f82-f111)
    { id: 'f82', title: 'Legendas Criativas Instagram', description: 'IA gera 3 opções de legendas com hashtags para posts da igreja.', category: 'IA Criativa', enabled: true },
    { id: 'f83', title: 'Gerador de Card de Versículo', description: 'Cria uma imagem artística com um versículo aleatório usando !card.', category: 'IA Criativa', enabled: true },
    { id: 'f84', title: 'Contação de Histórias Kids', description: 'IA narra uma história bíblica em áudio com efeitos sonoros (via TTS).', category: 'IA Criativa', enabled: false },
    { id: 'f85', title: 'Transcrição de Sermão em Blog', description: 'Transforma o áudio do culto em um post estruturado para site.', category: 'IA Criativa', enabled: false },
    { id: 'f86', title: 'IA Tradutora para Visitantes', description: 'Tradução em tempo real para fones de ouvido de visitantes estrangeiros.', category: 'IA Criativa', enabled: false },

    { id: 'f87', title: 'Teste de Dons Espirituais', description: 'Questionário interativo que identifica os dons do membro ao final.', category: 'Discipulado e Apoio', enabled: true },
    { id: 'f88', title: 'Monitor de Consolidadores', description: 'Bipa o pastor se um novo convertido não for visitado em 48h.', category: 'Discipulado e Apoio', enabled: false },
    { id: 'f89', title: 'Apoio Pré-Nupcial Bot', description: 'Série de 7 dias de conselhos e tarefas para noivos via Zap.', category: 'Discipulado e Apoio', enabled: false },
    { id: 'f90', title: 'SOS Luto Direto', description: 'Módulo de acolhimento imediato com promessas bíblicas para perdas.', category: 'Discipulado e Apoio', enabled: true },
    { id: 'f91', title: 'Alarme GPS Desviado', description: 'IA detecta 4 semanas sem check-in e avisa o "anjo da guarda".', category: 'Discipulado e Apoio', enabled: false },

    { id: 'f92', title: 'Mural de Doações (Troca)', description: 'Intermedia quem tem um fogão p/ doar com quem precisa na igreja.', category: 'Comunidade e Life Groups', enabled: false },
    { id: 'f93', title: 'Sugestão de Quebra-Gelo Dinâmico', description: 'Gera uma dinâmica baseada no tema da palavra da semana.', category: 'Comunidade e Life Groups', enabled: true },
    { id: 'f94', title: 'Check-in de Célula por Foto', description: 'IA conta quantas pessoas estão na foto da célula e gera relatório.', category: 'Comunidade e Life Groups', enabled: true },
    { id: 'f95', title: 'Guia de Multiplicação de Life', description: 'Consultoria da IA sobre como dividir a célula em duas.', category: 'Comunidade e Life Groups', enabled: false },
    { id: 'f96', title: 'Monitor de Saúde Espiritual Líder', description: 'Questionário mensal de burnout e saúde emocional do líder.', category: 'Comunidade e Life Groups', enabled: false },

    { id: 'f97', title: 'Gestão de Reembolsos por Foto', description: 'Líder manda foto da nota fiscal e IA preenche planilha financeira.', category: 'Gestão e Administração', enabled: true },
    { id: 'f98', title: 'Termômetro de Campanhas', description: 'Barra de progresso visual de arrecadação para obras/projetos.', category: 'Gestão e Administração', enabled: false },
    { id: 'f99', title: 'Achados e Perdidos Digital', description: 'Catálogo de fotos de itens perdidos na igreja com busca por IA.', category: 'Gestão e Administração', enabled: false },
    { id: 'f100', title: 'Reserva de Salas e Equipamentos', description: 'Bot gerencia agenda de salas de ensaio e projetores.', category: 'Gestão e Administração', enabled: false },

    { id: 'f101', title: 'Dicionário Teológico IA', description: 'Explica termos complexos (ex: Escatologia) de forma simples.', category: 'Educação e Teologia', enabled: true },
    { id: 'f102', title: 'Treinador de Memorização', description: 'Bot apaga palavras de um versículo p/ o membro completar.', category: 'Educação e Teologia', enabled: false },
    { id: 'f103', title: 'Coach de Plano de Leitura', description: 'IA cobra e incentiva quem está atrasado no plano bíblico.', category: 'Educação e Teologia', enabled: false },
    { id: 'f104', title: 'Consultoria de Ética Cristã', description: 'IA responde dilemas morais com base na doutrina bíblica.', category: 'Educação e Teologia', enabled: true },
    { id: 'f105', title: 'Resumo de Livros Cristãos', description: 'IA provê resumos e pontos chave de best-sellers da fé.', category: 'Educação e Teologia', enabled: false },

    { id: 'f107', title: 'Match de Voluntários', description: 'Cruza vagas nos ministérios com habilidades dos membros.', category: 'Operacional e Engajamento', enabled: false },
    { id: 'f108', title: 'Coleta de Feedback Pós-Culto', description: 'Envia 1 pergunta rápida sobre o que acharam da mensagem/louvor.', category: 'Operacional e Engajamento', enabled: true },
    { id: 'f109', title: 'Banco de Testemunhos IA', description: 'IA transcreve e organiza testemunhos para serem lidos no culto.', category: 'Operacional e Engajamento', enabled: false },
    { id: 'f110', title: 'Alerta de Oração Urgente', description: 'Push notification para todos os intercessores em casos graves.', category: 'Operacional e Engajamento', enabled: true },
    { id: 'f111', title: 'Retrospectiva Jornada da Fé', description: 'Relatório anual personalizado de crescimento do membro (Wrapped).', category: 'Operacional e Engajamento', enabled: false },
];

let cachedFeatures: BotFeature[] = [];

export function getFeatures(): BotFeature[] {
    if (cachedFeatures.length > 0) return cachedFeatures;

    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
            cachedFeatures = JSON.parse(data);

            // Verifica se a lista padrão é maior que a cacheada, add itens ausentes se necessário
            if (cachedFeatures.length < DEFAULT_FEATURES.length) {
                const mapIds = cachedFeatures.map(f => f.id);
                const novas = DEFAULT_FEATURES.filter(f => !mapIds.includes(f.id));
                cachedFeatures = [...cachedFeatures, ...novas];
                saveFeatures(cachedFeatures);
            }
        } else {
            cachedFeatures = DEFAULT_FEATURES;
            saveFeatures(cachedFeatures);
        }
    } catch (e) {
        console.error("Erro ao ler bot_features.json", e);
        cachedFeatures = DEFAULT_FEATURES;
    }

    return cachedFeatures;
}

export function saveFeatures(features: BotFeature[]) {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(features, null, 2));
        cachedFeatures = features;
    } catch (e) {
        console.error("Erro escrito bot_features.json", e);
    }
}

export function isFeatureActive(id: string): boolean {
    const list = getFeatures();
    const feat = list.find(f => f.id === id);
    return feat ? feat.enabled : false;
}

// Get feature flag active configs as string for AI Context
export function getActiveFeaturesForPrompt(): string {
    const list = getFeatures().filter(f => f.enabled);
    return list.map(f => `- [ON] ${f.title}: ${f.description}`).join('\n');
}
