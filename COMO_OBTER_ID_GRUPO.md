
### Como descobrir o ID do Grupo do WhatsApp

1.  Rode o bot localmente com `npm run dev` e conecte o WhatsApp.
2.  Peça para alguém **enviar qualquer mensagem no grupo da igreja** que o bot também esteja participando.
3.  Olhe no **Terminal** (onde você rodou o comando).
4.  O bot vai mostrar uma mensagem assim:
    
    `📢 Mensagem recebida do Grupo: 120363045...@g.us`

5.  Copie esse número (incluindo o `@g.us`) e cole no seu arquivo `.env` na variável `WHATSAPP_GROUP_ID`.
