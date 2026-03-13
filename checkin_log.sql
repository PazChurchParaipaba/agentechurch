-- Tabela para registrar o check-in de membros nos cultos
CREATE TABLE checkin_log (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    member_id BIGINT NOT NULL,
    event_name TEXT NOT NULL DEFAULT 'Culto de Domingo',
    checkin_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT fk_member
        FOREIGN KEY(member_id) 
        REFERENCES members_paraipaba(id)
        ON DELETE CASCADE
);

-- Criar um índice composto para buscas rápidas por membro e data
CREATE INDEX idx_checkin_log_member_event_date ON checkin_log(member_id, event_name, (checkin_at::date));

-- Habilitar a segurança de nível de linha (RLS)
ALTER TABLE checkin_log ENABLE ROW LEVEL SECURITY;

-- Permitir acesso total para o service_role
CREATE POLICY "Allow full access to service_role"
ON checkin_log
FOR ALL
USING (true)
WITH CHECK (true);

COMMENT ON TABLE checkin_log IS 'Registra a presença de um membro em um evento, como o culto de domingo.';
COMMENT ON COLUMN checkin_log.member_id IS 'Chave estrangeira para a tabela de membros.';
COMMENT ON COLUMN checkin_log.event_name IS 'Nome do evento (ex: "Culto de Domingo").';
COMMENT ON COLUMN checkin_log.checkin_at IS 'Data e hora exatas do check-in.';
