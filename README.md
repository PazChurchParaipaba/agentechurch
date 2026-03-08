# Agente Igreja WhatsApp

Sistema automatizado para gestão de membros e células da igreja via WhatsApp.

## 🚀 Funcionalidades

- **Aniversariantes**: Verifica diariamente no Supabase e envia mensagens.
- **Localização de Lives**: Encontra a célula mais próxima baseada na localização do usuário.
- **Anti-Ban**: Disparos com intervalos aleatórios.
- **Hospedagem**: Preparado para Railway.

## 🛠️ Configuração

1.  **Instale as dependências**:
    ```bash
    npm install
    ```

2.  **Configure o ambiente**:
    - Abra o arquivo `.env` e preencha:
        - `SUPABASE_URL`: Sua URL do projeto Supabase.
        - `SUPABASE_KEY`: Sua chave 'service_role' (não a anon, pois precisa de acesso total em background).
        - `WHATSAPP_GROUP_ID`: ID do grupo para avisos de aniversário (ex: `12036302...@g.us`).

3.  **Banco de Dados (Supabase)**:
    - Crie as tabelas conforme descrito em `IMPLEMENTATION_PLAN.md`.

4.  **Rodando Localmente**:
    ```bash
    npm run dev
    ```
    - Um QR Code aparecerá no terminal. Escaneie com o WhatsApp do "Agente".

5.  **Deploy na Railway**:
    - Conecte este repositório ao Railway.
    - Adicione as variáveis de ambiente no painel da Railway.
    - O comando de start (`npm start`) já está configurado.

## ⚠️ Atenção

- O uso de bots em contas pessoais pode levar a banimento. Use com moderação.
- O atraso entre mensagens (`delay`) é proposital para segurança.

## Estrutura

- `src/index.ts`: Servidor Express e inicialização.
- `src/services/whatsapp.ts`: Lógica do Bot (Baileys).
- `src/services/scheduler.ts`: Cron jobs (Agendamentos).
- `src/config/supabase.ts`: Conexão com banco.
