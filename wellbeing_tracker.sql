-- Tabela para rastrear o contato proativo com membros
-- Isso garante que o bot não envie mensagens de "como você está?" com muita frequência para a mesma pessoa.

CREATE TABLE proactive_outreach_log (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    member_id BIGINT NOT NULL,
    last_outreach_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_member
        FOREIGN KEY(member_id) 
        REFERENCES members_paraipaba(id)
        ON DELETE CASCADE
);

-- Criar um índice na coluna member_id para buscas rápidas
CREATE INDEX idx_proactive_outreach_log_member_id ON proactive_outreach_log(member_id);

-- Habilitar a segurança de nível de linha (RLS) é uma boa prática
ALTER TABLE proactive_outreach_log ENABLE ROW LEVEL SECURITY;

-- Permitir acesso total para o role 'service_role' (usado pela API do backend)
CREATE POLICY "Allow full access to service_role"
ON proactive_outreach_log
FOR ALL
USING (true)
WITH CHECK (true);

COMMENT ON TABLE proactive_outreach_log IS 'Registra quando o bot envia uma mensagem proativa de bem-estar para um membro.';
COMMENT ON COLUMN proactive_outreach_log.member_id IS 'Chave estrangeira para a tabela de membros.';
COMMENT ON COLUMN proactive_outreach_log.last_outreach_at IS 'Data e hora do último contato proativo.';
