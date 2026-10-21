\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  owner_one uuid;
  owner_two uuid;
  account_one uuid;
  account_two uuid;
  category_one uuid;
  category_two uuid;
  ledger_account_one uuid;
  expense_ledger_account uuid;
  transaction_one uuid;
  journal_one uuid;
  rejected boolean := false;
BEGIN
  SELECT id INTO STRICT owner_one FROM users WHERE email_normalized = 'owner@example.test';
  SELECT id INTO STRICT owner_two FROM users WHERE email_normalized = 'second@example.test';

  INSERT INTO financial_accounts (user_id, type, name)
  VALUES (owner_one, 'BANK', 'Schema test bank') RETURNING id INTO account_one;
  INSERT INTO financial_accounts (user_id, type, name)
  VALUES (owner_two, 'BANK', 'Other owner bank') RETURNING id INTO account_two;
  INSERT INTO categories (user_id, kind, name)
  VALUES (owner_one, 'EXPENSE', 'Schema test expense') RETURNING id INTO category_one;
  INSERT INTO categories (user_id, kind, name)
  VALUES (owner_one, 'INCOME', 'Schema test income') RETURNING id INTO category_two;

  BEGIN
    INSERT INTO financial_accounts (user_id, type, name, statement_day)
    VALUES (owner_one, 'BANK', 'Invalid card fields', 5);
    RAISE EXCEPTION 'non-card account accepted card-only fields';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO ledger_accounts (user_id, type, financial_account_id)
    VALUES (owner_one, 'ASSET', account_two);
    RAISE EXCEPTION 'cross-owner ledger mapping was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  INSERT INTO ledger_accounts (user_id, type, financial_account_id)
  VALUES (owner_one, 'ASSET', account_one) RETURNING id INTO ledger_account_one;
  INSERT INTO ledger_accounts (user_id, type, category_id)
  VALUES (owner_one, 'EXPENSE', category_one) RETURNING id INTO expense_ledger_account;

  BEGIN
    INSERT INTO ledger_accounts (user_id, type, category_id)
    VALUES (owner_one, 'EXPENSE', category_two);
    RAISE EXCEPTION 'income category received an expense ledger mapping';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  INSERT INTO ledger_accounts (user_id, type, internal_code)
  VALUES (owner_one, 'EQUITY', 'OPENING_BALANCE');

  INSERT INTO transactions (user_id, kind, occurred_on, category_id)
  VALUES (owner_one, 'EXPENSE', DATE '2026-10-22', category_one)
  RETURNING id INTO transaction_one;
  INSERT INTO transaction_revisions
    (user_id, transaction_id, version, before_json, after_json, actor_id)
  VALUES
    (owner_one, transaction_one, 1, NULL, '{"kind":"EXPENSE"}'::jsonb, owner_one);
  INSERT INTO journals (user_id, transaction_id, occurred_on, operation_kind)
  VALUES (owner_one, transaction_one, DATE '2026-10-22', 'EXPENSE')
  RETURNING id INTO journal_one;
  INSERT INTO postings (user_id, journal_id, ledger_account_id, direction, amount_minor)
  VALUES
    (owner_one, journal_one, expense_ledger_account, 'DEBIT', 100),
    (owner_one, journal_one, ledger_account_one, 'CREDIT', 100);

  BEGIN
    INSERT INTO postings (user_id, journal_id, ledger_account_id, direction, amount_minor)
    VALUES (owner_one, journal_one, ledger_account_one, 'DEBIT', 0);
    RAISE EXCEPTION 'zero-minor-unit posting was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE postings SET amount_minor = 200 WHERE journal_id = journal_one;
    RAISE EXCEPTION 'posted journal rows were mutable';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;

  BEGIN
    INSERT INTO transactions (user_id, kind, occurred_on, category_id)
    VALUES (owner_one, 'EXPENSE', DATE '2026-10-22', category_one)
    RETURNING id INTO transaction_one;
    INSERT INTO transaction_revisions
      (user_id, transaction_id, version, before_json, after_json, actor_id)
    VALUES
      (owner_one, transaction_one, 1, NULL, '{"kind":"EXPENSE"}'::jsonb, owner_one);
    INSERT INTO journals (user_id, transaction_id, occurred_on, operation_kind)
    VALUES (owner_one, transaction_one, DATE '2026-10-22', 'EXPENSE');
    SET CONSTRAINTS ALL IMMEDIATE;
    RAISE EXCEPTION 'unbalanced journal was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SET CONSTRAINTS ALL DEFERRED;

  BEGIN
    INSERT INTO idempotency_keys
      (user_id, key_hash, request_hash, expires_at)
    VALUES
      (owner_one, repeat('a', 64), repeat('b', 64), now() + interval '1 day'),
      (owner_one, repeat('a', 64), repeat('c', 64), now() + interval '1 day');
    RAISE EXCEPTION 'duplicate owner idempotency key was accepted';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  IF account_one = account_two THEN
    RAISE EXCEPTION 'test fixture UUIDs unexpectedly matched';
  END IF;
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;
ROLLBACK;
