ALTER TABLE categories
  ADD COLUMN icon text,
  ADD CONSTRAINT categories_icon_check CHECK (
    icon IS NULL OR icon ~ '^[a-z][a-z0-9-]{0,31}$'
  );
