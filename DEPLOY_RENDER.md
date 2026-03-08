# Deploy no Render.com

Se a Railway está complicado/pago, o **Render** é uma ótima alternativa gratuita.

## Passo a Passo

1.  Crie uma conta em [render.com](https://render.com).
2.  Clique em **New +** e escolha **Web Service**.
3.  Conecte seu repositório do GitHub.
4.  **Configurações**:
    - **Name**: `agente-igreja` (exemplo)
    - **Build Command**: `npm install && npm run build`
    - **Start Command**: `npm start`
    - **Environment Variables** (Copie do seu arquivo .env):
        - `SUPABASE_URL`
        - `SUPABASE_KEY`
        - `WHATSAPP_GROUP_ID`
        - `GEMINI_API_KEY`

5.  **Pegue a URL**:
    - Depois que terminar o deploy, o Render vai te dar uma URL (ex: `https://agente-igreja.onrender.com`).
    - Copie essa URL e atualize o arquivo `frontend/.env.production` no seu PC.
    - Faça o deploy do frontend (`npm run deploy`) novamente.
