-- Migration 0001: Enums and Profiles (Supabase-native)
-- Creates required ENUM types and the public.profiles table linked to Supabase auth.users

-- Enable UUID generation (used by audit and records)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- role_type ENUM: admin, manager, supervisor, front_desk, kitchen, bar, storekeeper
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'role_type'
  ) THEN
    CREATE TYPE role_type AS ENUM ('admin','manager','supervisor','front_desk','kitchen','bar','storekeeper');
  ELSE
    -- Ensure all required labels exist; we do not remove existing labels to avoid breaking dependencies
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'role_type'::regtype AND enumlabel = 'admin') THEN
      ALTER TYPE role_type ADD VALUE 'admin';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'role_type'::regtype AND enumlabel = 'manager') THEN
      ALTER TYPE role_type ADD VALUE 'manager';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'role_type'::regtype AND enumlabel = 'supervisor') THEN
      ALTER TYPE role_type ADD VALUE 'supervisor';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'role_type'::regtype AND enumlabel = 'front_desk') THEN
      ALTER TYPE role_type ADD VALUE 'front_desk';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'role_type'::regtype AND enumlabel = 'kitchen') THEN
      ALTER TYPE role_type ADD VALUE 'kitchen';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'role_type'::regtype AND enumlabel = 'bar') THEN
      ALTER TYPE role_type ADD VALUE 'bar';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'role_type'::regtype AND enumlabel = 'storekeeper') THEN
      ALTER TYPE role_type ADD VALUE 'storekeeper';
    END IF;
  END IF;
END$$;

-- approval_status ENUM: pending, approved, rejected
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'approval_status'
  ) THEN
    CREATE TYPE approval_status AS ENUM ('pending','approved','rejected');
  END IF;
END$$;

-- entity_type ENUM remains as defined: front_desk, kitchen, bar, storekeeper
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'entity_type'
  ) THEN
    CREATE TYPE entity_type AS ENUM ('front_desk','kitchen','bar','storekeeper');
  END IF;
END$$;

-- Supabase-native profiles table referencing auth.users(id)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  role role_type NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles((lower(email)));

-- Remove legacy local users table if present (superseded by profiles)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') THEN
    DROP TABLE public.users CASCADE;
  END IF;
END$$;