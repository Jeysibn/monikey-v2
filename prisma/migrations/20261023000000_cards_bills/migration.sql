CREATE TABLE card_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  card_account_id uuid NOT NULL,
  statement_date date NOT NULL,
  period_start date,
  period_end date,
  amount_due_minor bigint NOT NULL CHECK (amount_due_minor >= 0),
  payment_due_date date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_statements_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT card_statements_card_owner_fk
    FOREIGN KEY (user_id, card_account_id)
    REFERENCES financial_accounts (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT card_statements_period_check
    CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end)
);

CREATE INDEX card_statements_owner_card_date_idx
  ON card_statements (user_id, card_account_id, statement_date DESC, id DESC);

CREATE FUNCTION monikey_validate_card_statement_account() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE account_type text;
BEGIN
  SELECT type INTO account_type
    FROM financial_accounts
   WHERE user_id = NEW.user_id AND id = NEW.card_account_id;
  IF account_type IS DISTINCT FROM 'CREDIT_CARD' THEN
    RAISE EXCEPTION 'Card statements require a credit card account' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER card_statements_card_check
  BEFORE INSERT OR UPDATE ON card_statements
  FOR EACH ROW EXECUTE FUNCTION monikey_validate_card_statement_account();

CREATE TABLE card_statement_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  statement_id uuid NOT NULL,
  transaction_id uuid NOT NULL,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT card_statement_allocations_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT card_statement_allocations_statement_owner_fk
    FOREIGN KEY (user_id, statement_id)
    REFERENCES card_statements (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT card_statement_allocations_transaction_owner_fk
    FOREIGN KEY (user_id, transaction_id)
    REFERENCES transactions (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT card_statement_allocations_statement_transaction_unique
    UNIQUE (user_id, statement_id, transaction_id)
);

CREATE INDEX card_statement_allocations_owner_statement_idx
  ON card_statement_allocations (user_id, statement_id);

CREATE FUNCTION monikey_validate_card_statement_allocation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE transaction_kind text;
BEGIN
  SELECT kind INTO transaction_kind
    FROM transactions
   WHERE user_id = NEW.user_id AND id = NEW.transaction_id;
  IF transaction_kind IS DISTINCT FROM 'CARD_PAYMENT' THEN
    RAISE EXCEPTION 'Statement allocations require a card payment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER card_statement_allocations_kind_check
  BEFORE INSERT OR UPDATE ON card_statement_allocations
  FOR EACH ROW EXECUTE FUNCTION monikey_validate_card_statement_allocation();

CREATE TABLE bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category_id uuid NOT NULL,
  suggested_account_id uuid,
  amount_mode text NOT NULL CHECK (amount_mode IN ('FIXED', 'VARIABLE')),
  default_amount_minor bigint CHECK (default_amount_minor IS NULL OR default_amount_minor > 0),
  cadence text NOT NULL DEFAULT 'MONTHLY' CHECK (cadence = 'MONTHLY'),
  due_day smallint NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  start_on date NOT NULL,
  end_on date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'ARCHIVED')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bills_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT bills_category_owner_fk
    FOREIGN KEY (user_id, category_id)
    REFERENCES categories (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT bills_account_owner_fk
    FOREIGN KEY (user_id, suggested_account_id)
    REFERENCES financial_accounts (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT bills_dates_check CHECK (end_on IS NULL OR start_on <= end_on),
  CONSTRAINT bills_fixed_amount_check CHECK (
    (amount_mode = 'FIXED' AND default_amount_minor IS NOT NULL)
    OR (amount_mode = 'VARIABLE' AND default_amount_minor IS NULL)
  )
);

CREATE INDEX bills_owner_status_idx ON bills (user_id, status, due_day, name);

CREATE TABLE bill_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bill_id uuid NOT NULL,
  due_on date NOT NULL,
  expected_amount_minor bigint CHECK (expected_amount_minor IS NULL OR expected_amount_minor > 0),
  actual_amount_minor bigint CHECK (actual_amount_minor IS NULL OR actual_amount_minor > 0),
  status text NOT NULL DEFAULT 'UPCOMING' CHECK (status IN ('UPCOMING', 'OVERDUE', 'PAID', 'SKIPPED')),
  paid_transaction_id uuid,
  paid_at timestamptz,
  note text CHECK (note IS NULL OR length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bill_occurrences_owner_id_unique UNIQUE (user_id, id),
  CONSTRAINT bill_occurrences_bill_owner_fk
    FOREIGN KEY (user_id, bill_id) REFERENCES bills (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT bill_occurrences_transaction_owner_fk
    FOREIGN KEY (user_id, paid_transaction_id) REFERENCES transactions (user_id, id) ON DELETE RESTRICT,
  CONSTRAINT bill_occurrences_bill_due_unique UNIQUE (user_id, bill_id, due_on),
  CONSTRAINT bill_occurrences_paid_fields_check CHECK (
    (status = 'PAID' AND paid_transaction_id IS NOT NULL AND actual_amount_minor IS NOT NULL)
    OR (status <> 'PAID')
  )
);

CREATE INDEX bill_occurrences_owner_due_idx
  ON bill_occurrences (user_id, due_on, status, bill_id);
