import cron from 'node-cron';
import { supabase } from '../config/supabase';
import { waService } from './whatsapp';
import { getAIResponse } from './ai';

// Configuração do ID do grupo da igreja via .env ou Hardcoded (Correção solicitada)
const CHURCH_GROUP_ID = process.env.WHATSAPP_GROUP_ID || '120363134268223078@g.us';

// Número do Pastor ou Líder Principal para notificações
const LEADER_PHONE = process.env.LEADER_PHONE || '';

export function initScheduler() {
    console.log('📅 Inicializando agendador de tarefas...');

    // Tarefa 1: Verificar aniversariantes todos os dias às 08:00
    cron.schedule('0 8 * * *', async () => {
        console.log('🔍 Verificando aniversariantes do dia...');
        const today = new Date();
        const day = today.getDate();
        const month = today.getMonth() + 1; // JS months are 0-indexed

        const { data: members, error } = await supabase.from('members_paraipaba').select('*');

        if (error || !members) {
            console.error('Erro ao buscar membros para aniversário:', error);
            return;
        }

        const birthdays = members.filter((m: any) => {
            if (!m.birth_date) return false;
            // Robustez: aceitar Date object ou string YYYY-MM-DD
            const bdate = new Date(m.birth_date);
            // Resetar time para evitar bugs de fuso se vier com T00:00:00.000Z
            return bdate.getUTCDate() === day && (bdate.getUTCMonth() + 1) === month;
        });

        if (birthdays.length === 0) {
            console.log('Nenhum aniversariante hoje.');
            return;
        }

        console.log(`🎉 Encontrados ${birthdays.length} aniversariantes.`);

        // 1. Mandar DM privada para CADA UM
        for (const member of birthdays) {
            if (member.phone) {
                let jid = member.phone;
                if (!jid.includes('@')) {
                    jid = jid.length >= 14 ? `${jid}@lid` : `${jid}@s.whatsapp.net`;
                }

                try {
                    const prompt = `Gere uma mensagem curta e carinhosa de feliz aniversário de 1 parágrafo para o membro "${member.name}" da Paz Church Paraipaba. Use um tom pastoral e amigável. Cite um versículo de benção.`;
                    const aiMsg = await getAIResponse(prompt, member.phone);
                    const msg = aiMsg && !aiMsg.includes("Desculpe") ? aiMsg : `Olá *${member.name}*! Feliz aniversário! 🎉 Que Deus te abençoe ricamente hoje e sempre. Amamos sua vida! ❤️`;

                    await waService.sendMessage(jid, msg);
                } catch (e) {
                    const fallback = `Olá *${member.name}*, a paz! 🕊️\n\nDesejamos um Feliz Aniversário! 🎉🎂 Que o Senhor te abençoe ricamente hoje!`;
                    await waService.sendMessage(jid, fallback);
                }
            }
        }

        // 2. Mandar no Grupo uma Imagem Real Personalizada
        if (CHURCH_GROUP_ID) {
            for (const member of birthdays) {
                try {
                    const prompt = `Gere uma legenda festiva e alegre para um post de aniversário no grupo da igreja para o membro "${member.name}". Use emojis e termine convidando todos a darem parabéns.`;
                    const aiGroupMsg = await getAIResponse(prompt, CHURCH_GROUP_ID);
                    const groupMsg = aiGroupMsg && !aiGroupMsg.includes("Desculpe") ? aiGroupMsg : `🎉 *HOJE É DIA DE FESTA!* 🎉\n\nVamos celebrar a maravilhosa vida do(a) nosso(a) amado(a) *${member.name}*! 🎂🎈 Deixem seus parabéns aqui! 👏👏🎈`;

                    // Montar url da imagem (usando prompt em inglês customizado)
                    const promptImg = `A beautiful 3D birthday celebration card, Christian theme, bright and joyful, luxurious balloons and cake, elegant typography with the text "Feliz Aniversário ${member.name}", high quality, 8k`;

                    // Enviar a imagem com a legenda (via método do whatsapp.ts)
                    await waService.sendGeneratedImageMessage(CHURCH_GROUP_ID, promptImg, groupMsg);
                } catch (e) {
                    console.error("Erro ao enviar aniversário no grupo:", e);
                }
            }
        }
    }, { timezone: "America/Sao_Paulo" });

    // Tarefa 3: Devocional Diário (Melhoria 6) - Todo dia às 06:30
    cron.schedule('30 6 * * *', async () => {
        console.log('📖 Iniciando envio de devocional diário para todos os grupos...');

        try {
            // 1. Obter a lista de todos os grupos em que o bot está
            let groups: { id: string, subject: string }[] = [];
            if (waService.sock && waService.isConnected) {
                try {
                    const allGroups = await waService.sock.groupFetchAllParticipating();
                    groups = Object.values(allGroups).map((g: any) => ({
                        id: g.id,
                        subject: g.subject
                    }));
                } catch (groupError) {
                    console.error('Erro ao buscar grupos (socket pode estar instável):', groupError);
                }
            }

            if (groups.length === 0) {
                console.log('Nenhum grupo encontrado para enviar o devocional.');
                return;
            }
            
            console.log(`🕊️ Preparando devocional para ${groups.length} grupos.`);

            // 2. Gerar UMA mensagem de devocional para ser a mesma para todos
            const themes = ["Graça e Misericórdia", "Fé em tempos difíceis", "O poder da oração", "Amor ao próximo", "Gratidão", "Sabedoria de Provérbios", "A alegria do Senhor", "Caminhando com o Espírito Santo", "Vencendo o medo", "Propósito de vida em Cristo"];
            const randomTheme = themes[Math.floor(Math.random() * themes.length)];
            const todayStr = new Date().toLocaleDateString('pt-BR');
            
            const prompt = `Gere um devocional cristão INÉDITO para hoje (${todayStr}) sobre o tema "${randomTheme}". Instruções:
            1. Um título inspirador.
            2. Um versículo bíblico chave (capítulo e versículo).
            3. Uma reflexão prática de 2 a 3 parágrafos curtos.
            4. Uma oração final.
            5. Use poucos emojis, mantenha um tom de conselheiro maduro. Não repita textos anteriores.`;
            
            let devocional = await getAIResponse(prompt, 'scheduler');

            if (!devocional || devocional.includes("Desculpe") || devocional.includes("problema técnico")) {
                devocional = `☀️ *Bom dia Família!* ☀️\n\nHoje nossa reflexão é sobre *${randomTheme}*.\n\n"O Senhor é bom, um refúgio em tempos de angústia. Ele cuida dos que nele confiam." - Naum 1:7 📖\n\nQue sua manhã seja repleta da presença de Deus! 🙏`;
            }

            const finalMessage = `☀️ *BOM DIA FAMÍLIA PAZ!* ☀️\n_Devocional ${todayStr}_\n\n${devocional}\n\nTenha um dia vitorioso em nome de Jesus! 🙏🔥`;

            // 3. Enviar a mensagem para cada grupo com um pequeno delay
            for (const group of groups) {
                try {
                    await waService.sendMessage(group.id, finalMessage);
                    console.log(`Devocional enviado para o grupo: ${group.subject}`);
                    // Adiciona um delay de 1 a 3 segundos para não sobrecarregar
                    await new Promise(resolve => setTimeout(resolve, Math.floor(Math.random() * 2000) + 1000));
                } catch (err) {
                    console.error(`Erro ao enviar devocional para o grupo ${group.subject} (${group.id}):`, err);
                }
            }

            console.log('✅ Envio de devocionais concluído.');

        } catch (e) {
            console.error("Erro geral no job de devocional diário:", e);
        }
    }, { timezone: "America/Sao_Paulo" });

    // Tarefa 6: Lembrete de Culto de Domingo (Domingo às 09:00)
    cron.schedule('0 9 * * 0', async () => {
        if (!CHURCH_GROUP_ID) return;
        const msg = `🚨 *Bom dia Família Paz! Hoje é dia de Celebração!* 🚨\n\nVenha buscar ao Senhor conosco na Casa do Pai! 🔥\n\n📍 Paz Church Paraipaba\n⏰ Horário: 17h30\n\nPrepare seu coração, traga sua família e convide um amigo! 🙏✨`;
        await waService.sendMessage(CHURCH_GROUP_ID, msg);
    }, { timezone: "America/Sao_Paulo" });

    // Tarefa 7: Contato Proativo de Bem-Estar (Terça-feira às 10h)
    cron.schedule('0 10 * * 2', async () => {
        console.log('💖 Iniciando tarefa de contato proativo de bem-estar...');
        const OUTREACH_INTERVAL_DAYS = 15; // Intervalo de 15 dias para cada contato
        
        try {
            // 1. Buscar todos os membros
            const { data: allMembers, error: membersError } = await supabase
                .from('members_paraipaba')
                .select('id, name, phone');

            if (membersError) throw new Error(`Erro ao buscar membros: ${membersError.message}`);
            if (!allMembers || allMembers.length === 0) {
                console.log('Nenhum membro encontrado para o contato proativo.');
                return;
            }

            // 2. Buscar o log de contatos recentes
            const { data: recentLogs, error: logError } = await supabase
                .from('proactive_outreach_log')
                .select('member_id, last_outreach_at');
            
            if (logError) throw new Error(`Erro ao buscar logs de contato: ${logError.message}`);

            const logMap = new Map(recentLogs.map(log => [log.member_id, new Date(log.last_outreach_at)]));
            const now = new Date();
            const membersToContact = [];

            // 3. Filtrar membros que precisam de contato
            for (const member of allMembers) {
                const lastContact = logMap.get(member.id);
                if (!lastContact) {
                    membersToContact.push(member); // Nunca foi contatado
                } else {
                    const daysSinceLastContact = (now.getTime() - lastContact.getTime()) / (1000 * 3600 * 24);
                    if (daysSinceLastContact > OUTREACH_INTERVAL_DAYS) {
                        membersToContact.push(member);
                    }
                }
            }

            if (membersToContact.length === 0) {
                console.log('Nenhum membro precisando de contato proativo hoje.');
                return;
            }

            console.log(`Encontrados ${membersToContact.length} membros para contato de bem-estar.`);

            // 4. Enviar mensagem e registrar o log
            // Para não sobrecarregar, vamos contatar apenas alguns por vez (ex: 5 por execução)
            const membersForThisRun = membersToContact.slice(0, 5);

            for (const member of membersForThisRun) {
                if (!member.phone) continue;

                const prompt = `Gere uma mensagem curta, pessoal e carinhosa para ${member.name}. A mensagem é um "oi, sumido(a)" da igreja, para saber se a pessoa está bem. Use um tom caloroso e zero religioso ou formal. Ex: "Oi ${member.name}! Passando só pra saber como você tá. Espero que a semana esteja sendo boa! Se precisar de algo, me chama aqui. 🙏"`;
                let aiMessage = await getAIResponse(prompt, member.phone);

                if (!aiMessage || aiMessage.includes("Desculpe")) {
                    aiMessage = `Oi, ${member.name}! Tudo bem? Passando só pra saber como você está e te desejar uma semana abençoada. Se precisar de oração ou qualquer outra coisa, é só chamar! 🙏`;
                }
                
                // Envia a mensagem
                await waService.sendMessage(member.phone, aiMessage);
                
                // Registra/Atualiza o log
                await supabase.from('proactive_outreach_log').upsert(
                    { member_id: member.id, last_outreach_at: new Date().toISOString() },
                    { onConflict: 'member_id' }
                );

                console.log(`Mensagem de bem-estar enviada para ${member.name}.`);
                await new Promise(r => setTimeout(r, 5000)); // Delay entre mensagens
            }

        } catch (error) {
            console.error('Erro na tarefa de contato proativo:', error);
        }

    }, { timezone: "America/Sao_Paulo" });

    // ---------------------------------------------------------------
    // KEEP-ALIVE: pinga o próprio servidor a cada 10 minutos
    // Impede hibernação no Render free tier (dorme após 15 min idle)
    // Configure SELF_URL=https://seu-app.onrender.com no .env / painel
    // ---------------------------------------------------------------
    const SELF_URL = process.env.SELF_URL;
    if (SELF_URL) {
        let finalUrl = SELF_URL.trim();
        if (!finalUrl.startsWith('http')) {
            finalUrl = `https://${finalUrl}`;
        }
        
        console.log(`💓 Keep-alive ativado → pingando ${finalUrl} a cada 10 min`);
        cron.schedule('*/10 * * * *', async () => {
            try {
                const res = await fetch(`${finalUrl.replace(/\/$/, '')}/`);
                console.log(`💓 Keep-alive OK (status ${res.status})`);
            } catch (e: any) {
                console.warn(`💔 Keep-alive falhou em ${finalUrl}: ${e.message}`);
            }
        });
    } else {
        console.log('ℹ️ SELF_URL não configurado — keep-alive desativado');
    }
}
