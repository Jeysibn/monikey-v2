CREATE TABLE financial_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('CASH', 'BANK', 'EWALLET', 'CREDIT_CARD')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  institution text CHECK (institution IS NULL OR length(institution) BETWEEN 1 AND 120),
  currency char(3) NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
  archived_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  credit_limit_minor bigint,
  statement_day smallint,
  due_day smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_accounts_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT financial_accounts_card_fields_check CHECK (
    (type = 'CREDIT_CARD'
      AND (credit_limit_minor IS NULL OR credit_limit_minor > 0)
      AND (statement_day IS NULL OR statement_day BETWEEN 1 AND 31)
      AND (due_day IS NULL OR due_day BETWEEN 1 AND 31))
    OR (type <> 'CREDIT_CARD'
      AND credit_limit_minor IS NULL
      AND statement_day IS NULL
      AND due_day IS NULL)
  )
);

CREATE INDEX financial_accounts_owner_active_idx
  ON financial_accounts (user_id, sort_order, name)
  WHERE archived_at IS NULL;

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('INCOME', 'EXPENSE')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  sort_order integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT categories_owner_kind_name_unique UNIQUE (user_id, kind, name)
);

CREATE INDEX categories_owner_active_idx
  ON categories (user_id, kind, sort_order, name)
  WHERE archived_at IS NULL;

CREATE TABLE ledger_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('ASSET', 'LIABILITY', 'INCOME', 'EXPENSE', 'EQUITY')),
  financial_account_id uuid,
  category_id uuid,
  internal_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ledger_accounts_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT ledger_accounts_financial_account_owner_fk
    FOREIGN KEY (user_id, financial_account_id)
    REFERENCES financial_accounts (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT ledger_accounts_category_owner_fk
    FOREIGN KEY (user_id, category_id)
    REFERENCES categories (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT ledger_accounts_backing_check CHECK (
    (type IN ('ASSET', 'LIABILITY') AND financial_account_id IS NOT NULL AND category_id IS NULL AND internal_code IS NULL)
    OR (type IN ('INCOME', 'EXPENSE') AND financial_account_id IS NULL AND category_id IS NOT NULL AND internal_code IS NULL)
    OR (type = 'EQUITY' AND financial_account_id IS NULL AND category_id IS NULL AND internal_code IN ('OPENING_BALANCE', 'ADJUSTMENT'))
  )
);

CREATE UNIQUE INDEX ledger_accounts_financial_account_unique
  ON ledger_accounts (user_id, financial_account_id)
  WHERE financial_account_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_category_unique
  ON ledger_accounts (user_id, category_id)
  WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX ledger_accounts_internal_code_unique
  ON ledger_accounts (user_id, internal_code)
  WHERE internal_code IS NOT NULL;

CREATE FUNCTION monikey_validate_ledger_account_mapping() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  financial_type text;
  category_kind text;
BEGIN
  IF NEW.financial_account_id IS NOT NULL THEN
    SELECT type INTO financial_type
      FROM financial_accounts
     WHERE user_id = NEW.user_id AND id = NEW.financial_account_id;
    IF financial_type IS NOT NULL AND
       ((NEW.type = 'ASSET' AND financial_type = 'CREDIT_CARD') OR
        (NEW.type = 'LIABILITY' AND financial_type <> 'CREDIT_CARD')) THEN
      RAISE EXCEPTION 'Ledger type % does not match financial account type %', NEW.type, financial_type
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.category_id IS NOT NULL THEN
    SELECT kind INTO category_kind
      FROM categories
     WHERE user_id = NEW.user_id AND id = NEW.category_id;
    IF category_kind IS NOT NULL AND
       ((NEW.type = 'INCOME' AND category_kind <> 'INCOME') OR
        (NEW.type = 'EXPENSE' AND category_kind <> 'EXPENSE')) THEN
      RAISE EXCEPTION 'Ledger type % does not match category kind %', NEW.type, category_kind
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_accounts_mapping_check
  BEFORE INSERT ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION monikey_validate_ledger_account_mapping();

CREATE TABLE transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'ADJUSTMENT', 'CARD_PAYMENT')),
  status text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOID')),
  current_revision integer NOT NULL DEFAULT 1 CHECK (current_revision > 0),
  occurred_on date NOT NULL,
  category_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 500),
  refunded_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transactions_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT transactions_category_owner_fk
    FOREIGN KEY (user_id, category_id)
    REFERENCES categories (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transactions_refund_owner_fk
    FOREIGN KEY (user_id, refunded_transaction_id)
    REFERENCES transactions (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transactions_refund_reference_check CHECK (
    (kind = 'REFUND' AND refunded_transaction_id IS NOT NULL)
    OR (kind <> 'REFUND' AND refunded_transaction_id IS NULL)
  )
);

CREATE INDEX transactions_owner_activity_idx
  ON transactions (user_id, occurred_on DESC, created_at DESC, id DESC);
CREATE INDEX transactions_owner_category_activity_idx
  ON transactions (user_id, category_id, occurred_on DESC, id DESC)
  WHERE category_id IS NOT NULL;
CREATE INDEX transactions_owner_refund_idx
  ON transactions (user_id, refunded_transaction_id)
  WHERE refunded_transaction_id IS NOT NULL;

CREATE TABLE transaction_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  before_json jsonb,
  after_json jsonb NOT NULL CHECK (jsonb_typeof(after_json) = 'object'),
  actor_id uuid NOT NULL,
  reason text CHECK (reason IS NULL OR length(reason) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT transaction_revisions_transaction_owner_fk
    FOREIGN KEY (user_id, transaction_id)
    REFERENCES transactions (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transaction_revisions_actor_owner_fk
    FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT transaction_revisions_actor_check CHECK (actor_id = user_id),
  CONSTRAINT transaction_revisions_version_unique UNIQUE (user_id, transaction_id, version),
  CONSTRAINT transaction_revisions_id_transaction_unique UNIQUE (id, user_id, transaction_id)
);

ALTER TABLE transactions
  ADD CONSTRAINT transactions_current_revision_fk
  FOREIGN KEY (user_id, id, current_revision)
  REFERENCES transaction_revisions (user_id, transaction_id, version)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL,
  reversal_of uuid,
  occurred_on date NOT NULL,
  operation_kind text NOT NULL CHECK (operation_kind IN ('OPENING_BALANCE', 'INCOME', 'EXPENSE', 'TRANSFER', 'REFUND', 'ADJUSTMENT', 'CARD_PAYMENT', 'REVERSAL')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT journals_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT journals_transaction_owner_fk
    FOREIGN KEY (user_id, transaction_id)
    REFERENCES transactions (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT journals_reversal_owner_fk
    FOREIGN KEY (user_id, reversal_of)
    REFERENCES journals (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT journals_not_self_reversal_check CHECK (reversal_of IS NULL OR reversal_of <> id),
  CONSTRAINT journals_id_transaction_unique UNIQUE (id, user_id, transaction_id)
);

CREATE UNIQUE INDEX journals_one_reversal_per_original_unique
  ON journals (user_id, reversal_of)
  WHERE reversal_of IS NOT NULL;
CREATE INDEX journals_owner_transaction_idx
  ON journals (user_id, transaction_id, created_at DESC);

CREATE TABLE postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  journal_id uuid NOT NULL,
  ledger_account_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT postings_journal_owner_fk
    FOREIGN KEY (user_id, journal_id)
    REFERENCES journals (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT postings_ledger_account_owner_fk
    FOREIGN KEY (user_id, ledger_account_id)
    REFERENCES ledger_accounts (user_id, id) ON DELETE RESTRICT
);

CREATE INDEX postings_journal_idx ON postings (user_id, journal_id);
CREATE INDEX postings_ledger_account_idx ON postings (user_id, ledger_account_id, journal_id);

CREATE TABLE idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  key_hash char(64) NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED')),
  response_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT idempotency_keys_owner_key_unique UNIQUE (user_id, key_hash),
  CONSTRAINT idempotency_keys_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT idempotency_keys_response_check CHECK (
    (status = 'PENDING' AND response_json IS NULL)
    OR (status = 'COMPLETED' AND response_json IS NOT NULL)
  )
);

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (length(entity_type) BETWEEN 1 AND 60),
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  safe_metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(safe_metadata_json) = 'object'),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_actor_check CHECK (actor_id = user_id)
);

CREATE INDEX audit_events_owner_time_idx
  ON audit_events (user_id, occurred_at DESC, id DESC);
CREATE INDEX audit_events_entity_idx
  ON audit_events (user_id, entity_type, entity_id, occurred_at DESC);

CREATE FUNCTION monikey_reject_row_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are append-only', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER transaction_revisions_append_only
  BEFORE UPDATE OR DELETE ON transaction_revisions
  FOR EACH ROW EXECUTE FUNCTION monikey_reject_row_mutation();
CREATE TRIGGER journals_append_only
  BEFORE UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION monikey_reject_row_mutation();
CREATE TRIGGER postings_append_only
  BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION monikey_reject_row_mutation();
CREATE TRIGGER ledger_accounts_append_only
  BEFORE UPDATE OR DELETE ON ledger_accounts
  FOR EACH ROW EXECUTE FUNCTION monikey_reject_row_mutation();
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION monikey_reject_row_mutation();

CREATE FUNCTION monikey_assert_journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_journal_id uuid;
  posting_count bigint;
  debit_total numeric;
  credit_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'journals' THEN
    target_journal_id := NEW.id;
  ELSE
    target_journal_id := NEW.journal_id;
  END IF;

  SELECT count(*),
         COALESCE(sum(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0),
         COALESCE(sum(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)
    INTO posting_count, debit_total, credit_total
    FROM postings
   WHERE user_id = NEW.user_id AND journal_id = target_journal_id;

  IF posting_count < 2 OR debit_total <> credit_total THEN
    RAISE EXCEPTION 'Journal % must have at least two balanced postings', target_journal_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER journals_balance_at_commit
  AFTER INSERT ON journals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION monikey_assert_journal_balanced();
CREATE CONSTRAINT TRIGGER postings_balance_at_commit
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION monikey_assert_journal_balanced();
