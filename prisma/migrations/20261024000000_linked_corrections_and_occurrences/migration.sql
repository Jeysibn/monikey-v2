ALTER TABLE card_statement_allocations
  ADD COLUMN reversed_at timestamptz,
  ADD COLUMN reversal_reason text CHECK (reversal_reason IS NULL OR length(reversal_reason) <= 300),
  ADD CONSTRAINT card_statement_allocations_reversal_fields_check CHECK (
    (reversed_at IS NULL AND reversal_reason IS NULL)
    OR (reversed_at IS NOT NULL AND reversal_reason IS NOT NULL)
  );

-- Keep bill payment history after a correction reopens the current occurrence.
CREATE TABLE bill_occurrence_payment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurrence_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  sequence_number integer NOT NULL CHECK (sequence_number > 0),
  action text NOT NULL CHECK (action IN ('POSTED', 'EDITED', 'VOIDED')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_occurrence_payment_history_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT bill_occurrence_payment_history_occurrence_fk
    FOREIGN KEY (user_id, occurrence_id)
    REFERENCES bill_occurrences (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT bill_occurrence_payment_history_transaction_fk
    FOREIGN KEY (user_id, transaction_id)
    REFERENCES transactions (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT bill_occurrence_payment_history_sequence_unique
    UNIQUE (user_id, occurrence_id, sequence_number)
);

CREATE INDEX bill_occurrence_payment_history_occurrence_idx
  ON bill_occurrence_payment_history (user_id, occurrence_id, created_at);
