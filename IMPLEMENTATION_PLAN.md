# Projeto Agente Igreja - Planejamento e Arquitetura

## Visão Geral
Um sistema automatizado para gestão de comunicação da igreja via WhatsApp, focado em aniversariantes, direcionamento para células (Lives) e disparos programados seguros.

## Tecnologias Escolhidas
1.  **Linguagem**: Node.js com TypeScript (Robusto e tipado).
2.  **WhatsApp Engine**: `@whiskeysockets/baileys`
    *   *Por que?* Diferente de outras bibliotecas que exigem um navegador (Chrome) rodando em segundo plano (pesado para servidores), o Baileys conecta direto no socket do WhatsApp. É extremamente leve, consome pouca memória e é perfeito para rodar na Railway sem "dormir" ou travar.
3.  **Banco de Dados**: Supabase (PostgreSQL).
4.  **Hospedagem**: Railway (Servidor "Worker" + Web).
5.  **Frontend**: React + Vite + TailwindCSS (Interface moderna e responsiva).
6.  **Inteligência Artificial**: Google Gemini API (Para conversas humanizadas).
7.  **Agendamento**: `node-cron` para tarefas diárias (aniversários) e filas de disparos.

## Funcionalidades Detalhadas

### 1. Conexão WhatsApp & IA (Humanizada)
- **Engine**: Baileys (Socket direto).
- **Cérebro (IA)**: Integrar com a API do Google Gemini.
  - O bot terá um "System Prompt" (personalidade) de um atendente de igreja acolhedor, jovem e prestativo.
  - Ele não responderá como robô ("Opção 1..."), mas conversará naturalmente.
  - Detectará intenções: Se o usuário falar de "tristeza", oferece oração. Se falar de "visita", busca a Life/Célula.


### 2. Aniversariantes (Cron Job Diário)
- **Horário**: Todo dia às 08:00 (configurável).
- **Fluxo**:
  1. Consulta no Supabase membros com aniversário hoje.
  2. Envia mensagem privada (DM) parabenizando.
  3. Envia mensagem no Grupo da Igreja (ID configurado) com o nome/foto do membro.

### 3. Sistema de "Lives" (Células) Próximas
- O bot ouvirá mensagens. Se o usuário pedir "quero visitar uma célula" ou "life", o bot pedirá a localização (ou CEP).
- O sistema calculará a distância entre o membro e as Lives cadastradas no banco (usando Haversine Formula).
- Retornará a opção mais próxima com contato do líder.

### 4. Disparos Programados (Anti-Bloqueio)
- **Fila de Envio**: As mensagens não são enviadas todas de uma vez (broadcast).
- **Delay Inteligente**: "Dormir" entre 30 a 120 segundos aleatoriamente entre cada envio.
- Isso simula comportamento humano e previne banimento do chip.

### 5. Envio de Fotos
- Suporte para envio de mídia (imagens/cards de eventos) seguindo a mesma lógica de fila.

### 6. Interface Web (Dashboard)
- **Tecnologia**: React + Vite.
- **Páginas**:
  - **Login**: Acesso restrito para admin.
  - **Dashboard**: Visão geral (aniversariantes do dia, disparos pendentes).
  - **Membros**: Listagem, edição e cadastro manual.
  - **Cadastro Público**: Link compartilhável para o próprio membro se cadastrar.
  - **Disparos**: Criar nova mensagem programada (com upload de foto).

## Estrutura de Dados (Sugestão para Supabase)

Você precisará criar estas tabelas no seu Supabase:

```sql
-- Tabela de Configurações (ex: ID do grupo da igreja)
create table settings (
  key text primary key,
  value text not null
);

-- Tabela de Membros
create table members (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  phone text unique not null, -- Formato: 5511999999999
  birth_date date,
  address text,
  latitude double precision,
  longitude double precision,
  created_at timestamp with time zone default now()
);

-- Tabela de Lives (Células/Grupos)
create table lifes (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  leader_name text,
  leader_phone text,
  address text,
  latitude double precision, -- Necessário para cálculo de distância
  longitude double precision,
  meeting_day text -- ex: 'Quarta-feira às 20h'
);

-- Tabela de Mensagens Programadas
create table scheduled_messages (
  id uuid primary key default uuid_generate_v4(),
  message_text text,
  image_url text,
  scheduled_at timestamp with time zone not null,
  status text default 'pending', -- pending, sent, failed
  target_group text, -- 'all', 'leaders', 'specific_member'
  specific_phone text
);
```

## Próximos Passos
1. Configurar Frontend (React + Vite).
2. Instalar SDK do Google Gemini (`@google/generative-ai`).
3. Criar API Endpoints no Express para o Frontend consumir (GET /members, POST /send).
4. Integrar IA no fluxo de mensagens do WhatsApp.
