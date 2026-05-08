--
-- PostgreSQL database dump
--

\restrict Q3OanUTCbpdjek2Av6YnfGFtV8BjFU8ethjgoWqrZN1tn6uPrpMh5hdqYHunahB

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA auth;


ALTER SCHEMA auth OWNER TO supabase_admin;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA extensions;


ALTER SCHEMA extensions OWNER TO postgres;

--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA graphql;


ALTER SCHEMA graphql OWNER TO supabase_admin;

--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA graphql_public;


ALTER SCHEMA graphql_public OWNER TO supabase_admin;

--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: pgbouncer
--

CREATE SCHEMA pgbouncer;


ALTER SCHEMA pgbouncer OWNER TO pgbouncer;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA realtime;


ALTER SCHEMA realtime OWNER TO supabase_admin;

--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA storage;


ALTER SCHEMA storage OWNER TO supabase_admin;

--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: supabase_admin
--

CREATE SCHEMA vault;


ALTER SCHEMA vault OWNER TO supabase_admin;

--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


ALTER TYPE auth.aal_level OWNER TO supabase_auth_admin;

--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


ALTER TYPE auth.code_challenge_method OWNER TO supabase_auth_admin;

--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


ALTER TYPE auth.factor_status OWNER TO supabase_auth_admin;

--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


ALTER TYPE auth.factor_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


ALTER TYPE auth.oauth_authorization_status OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


ALTER TYPE auth.oauth_client_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


ALTER TYPE auth.oauth_registration_type OWNER TO supabase_auth_admin;

--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


ALTER TYPE auth.oauth_response_type OWNER TO supabase_auth_admin;

--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


ALTER TYPE auth.one_time_token_type OWNER TO supabase_auth_admin;

--
-- Name: AllocationMethod; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AllocationMethod" AS ENUM (
    'NEW_REF',
    'AGAINST_REF',
    'ADVANCE',
    'ON_ACCOUNT'
);


ALTER TYPE public."AllocationMethod" OWNER TO postgres;

--
-- Name: AllocationSourceType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AllocationSourceType" AS ENUM (
    'VOUCHER',
    'PAYMENT',
    'INVOICE',
    'JOURNAL_ENTRY'
);


ALTER TYPE public."AllocationSourceType" OWNER TO postgres;

--
-- Name: AllocationTargetType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."AllocationTargetType" AS ENUM (
    'INVOICE',
    'VOUCHER',
    'JOURNAL_ENTRY'
);


ALTER TYPE public."AllocationTargetType" OWNER TO postgres;

--
-- Name: BillRefMethod; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."BillRefMethod" AS ENUM (
    'NEW_REF',
    'AGAINST_REF',
    'ADVANCE',
    'ON_ACCOUNT'
);


ALTER TYPE public."BillRefMethod" OWNER TO postgres;

--
-- Name: ChatMessageType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ChatMessageType" AS ENUM (
    'SYSTEM',
    'USER'
);


ALTER TYPE public."ChatMessageType" OWNER TO postgres;

--
-- Name: ChatRoomType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ChatRoomType" AS ENUM (
    'SYSTEM_INBOX',
    'PERSONAL_INBOX',
    'ROLE_GROUP',
    'ORG_GROUP',
    'DIRECT_MESSAGE'
);


ALTER TYPE public."ChatRoomType" OWNER TO postgres;

--
-- Name: EntryType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."EntryType" AS ENUM (
    'DEBIT',
    'CREDIT'
);


ALTER TYPE public."EntryType" OWNER TO postgres;

--
-- Name: EscalationType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."EscalationType" AS ENUM (
    'INTERNAL',
    'EXTERNAL',
    'VENDOR'
);


ALTER TYPE public."EscalationType" OWNER TO postgres;

--
-- Name: GlAccountType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."GlAccountType" AS ENUM (
    'ASSET',
    'LIABILITY',
    'EQUITY',
    'REVENUE',
    'EXPENSE'
);


ALTER TYPE public."GlAccountType" OWNER TO postgres;

--
-- Name: GroupType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."GroupType" AS ENUM (
    'ASSET',
    'LIABILITY',
    'INCOME',
    'EXPENSE'
);


ALTER TYPE public."GroupType" OWNER TO postgres;

--
-- Name: GstRegType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."GstRegType" AS ENUM (
    'REGULAR',
    'COMPOSITION',
    'SEZ',
    'UNREGISTERED'
);


ALTER TYPE public."GstRegType" OWNER TO postgres;

--
-- Name: InvVoucherType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvVoucherType" AS ENUM (
    'PURCHASE',
    'SALE',
    'ESTIMATE',
    'RECEIPT',
    'ISSUE',
    'ADJUSTMENT',
    'STOCK_JOURNAL',
    'PHYSICAL_STOCK',
    'GRN',
    'CHALLAN',
    'REJECTION_IN',
    'REJECTION_OUT',
    'SALES_ORDER',
    'PURCHASE_ORDER'
);


ALTER TYPE public."InvVoucherType" OWNER TO postgres;

--
-- Name: InvoiceStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."InvoiceStatus" AS ENUM (
    'DRAFT',
    'SENT',
    'PARTIAL',
    'PAID',
    'VOID'
);


ALTER TYPE public."InvoiceStatus" OWNER TO postgres;

--
-- Name: LogVisibility; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."LogVisibility" AS ENUM (
    'INTERNAL',
    'CUSTOMER',
    'PUBLIC'
);


ALTER TYPE public."LogVisibility" OWNER TO postgres;

--
-- Name: NormalBalance; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."NormalBalance" AS ENUM (
    'DEBIT',
    'CREDIT'
);


ALTER TYPE public."NormalBalance" OWNER TO postgres;

--
-- Name: OrderSource; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."OrderSource" AS ENUM (
    'ONLINE',
    'IN_STORE',
    'PHONE',
    'WHATSAPP',
    'OTHER'
);


ALTER TYPE public."OrderSource" OWNER TO postgres;

--
-- Name: OverrideType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."OverrideType" AS ENUM (
    'GRANT',
    'DENY'
);


ALTER TYPE public."OverrideType" OWNER TO postgres;

--
-- Name: PaymentMethod; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."PaymentMethod" AS ENUM (
    'CASH',
    'BANK_TRANSFER',
    'CARD',
    'CHEQUE',
    'MOBILE_PAYMENT',
    'OTHER'
);


ALTER TYPE public."PaymentMethod" OWNER TO postgres;

--
-- Name: Priority; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Priority" AS ENUM (
    'LOW',
    'MEDIUM',
    'HIGH',
    'URGENT'
);


ALTER TYPE public."Priority" OWNER TO postgres;

--
-- Name: ResetPolicy; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ResetPolicy" AS ENUM (
    'NEVER',
    'YEARLY',
    'MONTHLY',
    'FY'
);


ALTER TYPE public."ResetPolicy" OWNER TO postgres;

--
-- Name: ShopOrderStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."ShopOrderStatus" AS ENUM (
    'DRAFT',
    'PENDING_PAYMENT',
    'PAID',
    'PACKED',
    'SHIPPED',
    'DELIVERED',
    'REFUNDED',
    'CANCELLED'
);


ALTER TYPE public."ShopOrderStatus" OWNER TO postgres;

--
-- Name: Taxability; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."Taxability" AS ENUM (
    'TAXABLE',
    'EXEMPT',
    'NIL_RATED',
    'NON_GST'
);


ALTER TYPE public."Taxability" OWNER TO postgres;

--
-- Name: UserScope; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."UserScope" AS ENUM (
    'OWN',
    'TEAM',
    'DEPARTMENT',
    'BRANCH',
    'REGION',
    'ORG'
);


ALTER TYPE public."UserScope" OWNER TO postgres;

--
-- Name: VoucherStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."VoucherStatus" AS ENUM (
    'DRAFT',
    'POSTED',
    'CANCELLED'
);


ALTER TYPE public."VoucherStatus" OWNER TO postgres;

--
-- Name: VoucherType; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."VoucherType" AS ENUM (
    'JOURNAL',
    'CONTRA',
    'PAYMENT',
    'RECEIPT',
    'CREDIT_NOTE',
    'DEBIT_NOTE',
    'SALE',
    'PURCHASE',
    'ESTIMATE',
    'STOCK_ISSUE',
    'STOCK_RECEIPT',
    'STOCK_ADJUSTMENT',
    'STOCK_JOURNAL',
    'PHYSICAL_STOCK',
    'STOCK_REJECTION_IN',
    'STOCK_REJECTION_OUT',
    'SALES_ORDER',
    'PURCHASE_ORDER',
    'DELIVERY_CHALLAN',
    'GOODS_RECEIPT_NOTE'
);


ALTER TYPE public."VoucherType" OWNER TO postgres;

--
-- Name: WarrantyStatus; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public."WarrantyStatus" AS ENUM (
    'NONE',
    'ACTIVE',
    'VOID',
    'CLAIMED'
);


ALTER TYPE public."WarrantyStatus" OWNER TO postgres;

--
-- Name: action; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


ALTER TYPE realtime.action OWNER TO supabase_admin;

--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in'
);


ALTER TYPE realtime.equality_op OWNER TO supabase_admin;

--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text
);


ALTER TYPE realtime.user_defined_filter OWNER TO supabase_admin;

--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


ALTER TYPE realtime.wal_column OWNER TO supabase_admin;

--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: supabase_admin
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


ALTER TYPE realtime.wal_rls OWNER TO supabase_admin;

--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


ALTER TYPE storage.buckettype OWNER TO supabase_storage_admin;

--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


ALTER FUNCTION auth.email() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


ALTER FUNCTION auth.jwt() OWNER TO supabase_auth_admin;

--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


ALTER FUNCTION auth.role() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: supabase_auth_admin
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;

--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_cron_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
DECLARE
    func_is_graphql_resolve bool;
BEGIN
    func_is_graphql_resolve = (
        SELECT n.proname = 'resolve'
        FROM pg_event_trigger_ddl_commands() AS ev
        LEFT JOIN pg_catalog.pg_proc AS n
        ON ev.objid = n.oid
    );

    IF func_is_graphql_resolve
    THEN
        -- Update public wrapper to pass all arguments through to the pg_graphql resolve func
        DROP FUNCTION IF EXISTS graphql_public.graphql;
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language sql
        as $$
            select graphql.resolve(
                query := query,
                variables := coalesce(variables, '{}'),
                "operationName" := "operationName",
                extensions := extensions
            );
        $$;

        -- This hook executes when `graphql.resolve` is created. That is not necessarily the last
        -- function in the extension so we need to grant permissions on existing entities AND
        -- update default permissions to any others that are created after `graphql.resolve`
        grant usage on schema graphql to postgres, anon, authenticated, service_role;
        grant select on all tables in schema graphql to postgres, anon, authenticated, service_role;
        grant execute on all functions in schema graphql to postgres, anon, authenticated, service_role;
        grant all on all sequences in schema graphql to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on tables to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on functions to postgres, anon, authenticated, service_role;
        alter default privileges in schema graphql grant all on sequences to postgres, anon, authenticated, service_role;

        -- Allow postgres role to allow granting usage on graphql and graphql_public schemas to custom roles
        grant usage on schema graphql_public to postgres with grant option;
        grant usage on schema graphql to postgres with grant option;
    END IF;

END;
$_$;


ALTER FUNCTION extensions.grant_pg_graphql_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


ALTER FUNCTION extensions.grant_pg_net_access() OWNER TO supabase_admin;

--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_ddl_watch() OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


ALTER FUNCTION extensions.pgrst_drop_watch() OWNER TO supabase_admin;

--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: supabase_admin
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


ALTER FUNCTION extensions.set_graphql_placeholder() OWNER TO supabase_admin;

--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: supabase_admin
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: supabase_admin
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


ALTER FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) OWNER TO supabase_admin;

--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: supabase_admin
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


ALTER FUNCTION pgbouncer.get_auth(p_usename text) OWNER TO supabase_admin;

--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
-- Regclass of the table e.g. public.notes
entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

-- I, U, D, T: insert, update ...
action realtime.action = (
    case wal ->> 'action'
        when 'I' then 'INSERT'
        when 'U' then 'UPDATE'
        when 'D' then 'DELETE'
        else 'ERROR'
    end
);

-- Is row level security enabled for the table
is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

subscriptions realtime.subscription[] = array_agg(subs)
    from
        realtime.subscription subs
    where
        subs.entity = entity_
        -- Filter by action early - only get subscriptions interested in this action
        -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
        and (subs.action_filter = '*' or subs.action_filter = action::text);

-- Subscription vars
roles regrole[] = array_agg(distinct us.claims_role::text)
    from
        unnest(subscriptions) us;

working_role regrole;
claimed_role regrole;
claims jsonb;

subscription_id uuid;
subscription_has_access bool;
visible_to_subscription_ids uuid[] = '{}';

-- structured info for wal's columns
columns realtime.wal_column[];
-- previous identity values for update/delete
old_columns realtime.wal_column[];

error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

-- Primary jsonb output for record
output jsonb;

begin
perform set_config('role', null, true);

columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'columns') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

old_columns =
    array_agg(
        (
            x->>'name',
            x->>'type',
            x->>'typeoid',
            realtime.cast(
                (x->'value') #>> '{}',
                coalesce(
                    (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                    (x->>'type')::regtype
                )
            ),
            (pks ->> 'name') is not null,
            true
        )::realtime.wal_column
    )
    from
        jsonb_array_elements(wal -> 'identity') x
        left join jsonb_array_elements(wal -> 'pk') pks
            on (x ->> 'name') = (pks ->> 'name');

for working_role in select * from unnest(roles) loop

    -- Update `is_selectable` for columns and old_columns
    columns =
        array_agg(
            (
                c.name,
                c.type_name,
                c.type_oid,
                c.value,
                c.is_pkey,
                pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
            )::realtime.wal_column
        )
        from
            unnest(columns) c;

    old_columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(old_columns) c;

    if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            -- subscriptions is already filtered by entity
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 400: Bad Request, no primary key']
        )::realtime.wal_rls;

    -- The claims role does not have SELECT permission to the primary key of entity
    elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
        return next (
            jsonb_build_object(
                'schema', wal ->> 'schema',
                'table', wal ->> 'table',
                'type', action
            ),
            is_rls_enabled,
            (select array_agg(s.subscription_id) from unnest(subscriptions) as s where claims_role = working_role),
            array['Error 401: Unauthorized']
        )::realtime.wal_rls;

    else
        output = jsonb_build_object(
            'schema', wal ->> 'schema',
            'table', wal ->> 'table',
            'type', action,
            'commit_timestamp', to_char(
                ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
            ),
            'columns', (
                select
                    jsonb_agg(
                        jsonb_build_object(
                            'name', pa.attname,
                            'type', pt.typname
                        )
                        order by pa.attnum asc
                    )
                from
                    pg_attribute pa
                    join pg_type pt
                        on pa.atttypid = pt.oid
                where
                    attrelid = entity_
                    and attnum > 0
                    and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
            )
        )
        -- Add "record" key for insert and update
        || case
            when action in ('INSERT', 'UPDATE') then
                jsonb_build_object(
                    'record',
                    (
                        select
                            jsonb_object_agg(
                                -- if unchanged toast, get column name and value from old record
                                coalesce((c).name, (oc).name),
                                case
                                    when (c).name is null then (oc).value
                                    else (c).value
                                end
                            )
                        from
                            unnest(columns) c
                            full outer join unnest(old_columns) oc
                                on (c).name = (oc).name
                        where
                            coalesce((c).is_selectable, (oc).is_selectable)
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                    )
                )
            else '{}'::jsonb
        end
        -- Add "old_record" key for update and delete
        || case
            when action = 'UPDATE' then
                jsonb_build_object(
                        'old_record',
                        (
                            select jsonb_object_agg((c).name, (c).value)
                            from unnest(old_columns) c
                            where
                                (c).is_selectable
                                and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                        )
                    )
            when action = 'DELETE' then
                jsonb_build_object(
                    'old_record',
                    (
                        select jsonb_object_agg((c).name, (c).value)
                        from unnest(old_columns) c
                        where
                            (c).is_selectable
                            and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                    )
                )
            else '{}'::jsonb
        end;

        -- Create the prepared statement
        if is_rls_enabled and action <> 'DELETE' then
            if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                deallocate walrus_rls_stmt;
            end if;
            execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
        end if;

        visible_to_subscription_ids = '{}';

        for subscription_id, claims in (
                select
                    subs.subscription_id,
                    subs.claims
                from
                    unnest(subscriptions) subs
                where
                    subs.entity = entity_
                    and subs.claims_role = working_role
                    and (
                        realtime.is_visible_through_filters(columns, subs.filters)
                        or (
                          action = 'DELETE'
                          and realtime.is_visible_through_filters(old_columns, subs.filters)
                        )
                    )
        ) loop

            if not is_rls_enabled or action = 'DELETE' then
                visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
            else
                -- Check if RLS allows the role to see the record
                perform
                    -- Trim leading and trailing quotes from working_role because set_config
                    -- doesn't recognize the role as valid if they are included
                    set_config('role', trim(both '"' from working_role::text), true),
                    set_config('request.jwt.claims', claims::text, true);

                execute 'execute walrus_rls_stmt' into subscription_has_access;

                if subscription_has_access then
                    visible_to_subscription_ids = visible_to_subscription_ids || subscription_id;
                end if;
            end if;
        end loop;

        perform set_config('role', null, true);

        return next (
            output,
            is_rls_enabled,
            visible_to_subscription_ids,
            case
                when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                else '{}'
            end
        )::realtime.wal_rls;

    end if;
end loop;

perform set_config('role', null, true);
end;
$$;


ALTER FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) OWNER TO supabase_admin;

--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


ALTER FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) OWNER TO supabase_admin;

--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


ALTER FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) OWNER TO supabase_admin;

--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


ALTER FUNCTION realtime."cast"(val text, type_ regtype) OWNER TO supabase_admin;

--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
      /*
      Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
      */
      declare
          op_symbol text = (
              case
                  when op = 'eq' then '='
                  when op = 'neq' then '!='
                  when op = 'lt' then '<'
                  when op = 'lte' then '<='
                  when op = 'gt' then '>'
                  when op = 'gte' then '>='
                  when op = 'in' then '= any'
                  else 'UNKNOWN OP'
              end
          );
          res boolean;
      begin
          execute format(
              'select %L::'|| type_::text || ' ' || op_symbol
              || ' ( %L::'
              || (
                  case
                      when op = 'in' then type_::text || '[]'
                      else type_::text end
              )
              || ')', val_1, val_2) into res;
          return res;
      end;
      $$;


ALTER FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) OWNER TO supabase_admin;

--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    AS $_$
    /*
    Should the record be visible (true) or filtered out (false) after *filters* are applied
    */
        select
            -- Default to allowed when no filters present
            $2 is null -- no filters. this should not happen because subscriptions has a default
            or array_length($2, 1) is null -- array length of an empty array is null
            or bool_and(
                coalesce(
                    realtime.check_equality_op(
                        op:=f.op,
                        type_:=coalesce(
                            col.type_oid::regtype, -- null when wal2json version <= 2.4
                            col.type_name::regtype
                        ),
                        -- cast jsonb to text
                        val_1:=col.value #>> '{}',
                        val_2:=f.value
                    ),
                    false -- if null, filter does not match
                )
            )
        from
            unnest(filters) f
            join unnest(columns) col
                on f.column_name = col.name;
    $_$;


ALTER FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) OWNER TO supabase_admin;

--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL AND ppt.tablename NOT LIKE '% %'),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  -- Count raw slot entries before apply_rls/subscription filter
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  -- Apply RLS and filter as before
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  -- Real rows with slot count attached
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  -- Sentinel row: always returned when no real rows exist so Elixir can
  -- always read slot_changes_count. Identified by wal IS NULL.
  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


ALTER FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) OWNER TO supabase_admin;

--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
      select
        (
          select string_agg('' || ch,'')
          from unnest(string_to_array(nsp.nspname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
        )
        || '.'
        || (
          select string_agg('' || ch,'')
          from unnest(string_to_array(pc.relname::text, null)) with ordinality x(ch, idx)
          where
            not (x.idx = 1 and x.ch = '"')
            and not (
              x.idx = array_length(string_to_array(nsp.nspname::text, null), 1)
              and x.ch = '"'
            )
          )
      from
        pg_class pc
        join pg_namespace nsp
          on pc.relnamespace = nsp.oid
      where
        pc.oid = entity
    $$;


ALTER FUNCTION realtime.quote_wal2json(entity regclass) OWNER TO supabase_admin;

--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    -- Generate a new UUID for the id
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    -- Attempt to insert the message
    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      -- Capture and notify the error
      RAISE WARNING 'ErrorSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


ALTER FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) OWNER TO supabase_admin;

--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    /*
    Validates that the user defined filters for a subscription:
    - refer to valid columns that the claimed role may access
    - values are coercable to the correct column type
    */
    declare
        col_names text[] = coalesce(
                array_agg(c.column_name order by c.ordinal_position),
                '{}'::text[]
            )
            from
                information_schema.columns c
            where
                format('%I.%I', c.table_schema, c.table_name)::regclass = new.entity
                and pg_catalog.has_column_privilege(
                    (new.claims ->> 'role'),
                    format('%I.%I', c.table_schema, c.table_name)::regclass,
                    c.column_name,
                    'SELECT'
                );
        filter realtime.user_defined_filter;
        col_type regtype;

        in_val jsonb;
    begin
        for filter in select * from unnest(new.filters) loop
            -- Filtered column is valid
            if not filter.column_name = any(col_names) then
                raise exception 'invalid column for filter %', filter.column_name;
            end if;

            -- Type is sanitized and safe for string interpolation
            col_type = (
                select atttypid::regtype
                from pg_catalog.pg_attribute
                where attrelid = new.entity
                      and attname = filter.column_name
            );
            if col_type is null then
                raise exception 'failed to lookup type for column %', filter.column_name;
            end if;

            -- Set maximum number of entries for in filter
            if filter.op = 'in'::realtime.equality_op then
                in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
                if coalesce(jsonb_array_length(in_val), 0) > 100 then
                    raise exception 'too many values for `in` filter. Maximum 100';
                end if;
            else
                -- raises an exception if value is not coercable to type
                perform realtime.cast(filter.value, col_type);
            end if;

        end loop;

        -- Apply consistent order to filters so the unique constraint on
        -- (subscription_id, entity, filters) can't be tricked by a different filter order
        new.filters = coalesce(
            array_agg(f order by f.column_name, f.op, f.value),
            '{}'
        ) from unnest(new.filters) f;

        return new;
    end;
    $$;


ALTER FUNCTION realtime.subscription_check_filters() OWNER TO supabase_admin;

--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: supabase_admin
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


ALTER FUNCTION realtime.to_regrole(role_name text) OWNER TO supabase_admin;

--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


ALTER FUNCTION realtime.topic() OWNER TO supabase_realtime_admin;

--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


ALTER FUNCTION storage.allow_any_operation(expected_operations text[]) OWNER TO supabase_storage_admin;

--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


ALTER FUNCTION storage.allow_only_operation(expected_operation text) OWNER TO supabase_storage_admin;

--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


ALTER FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) OWNER TO supabase_storage_admin;

--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


ALTER FUNCTION storage.enforce_bucket_name_length() OWNER TO supabase_storage_admin;

--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


ALTER FUNCTION storage.extension(name text) OWNER TO supabase_storage_admin;

--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[array_length(_parts,1)];
END
$$;


ALTER FUNCTION storage.filename(name text) OWNER TO supabase_storage_admin;

--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


ALTER FUNCTION storage.foldername(name text) OWNER TO supabase_storage_admin;

--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


ALTER FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) OWNER TO supabase_storage_admin;

--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


ALTER FUNCTION storage.get_size_by_bucket() OWNER TO supabase_storage_admin;

--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


ALTER FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer, next_key_token text, next_upload_token text) OWNER TO supabase_storage_admin;

--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer, start_after text, next_token text, sort_order text) OWNER TO supabase_storage_admin;

--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


ALTER FUNCTION storage.operation() OWNER TO supabase_storage_admin;

--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION storage.protect_delete() OWNER TO supabase_storage_admin;

--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


ALTER FUNCTION storage.search(prefix text, bucketname text, limits integer, levels integer, offsets integer, search text, sortcolumn text, sortorder text) OWNER TO supabase_storage_admin;

--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


ALTER FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


ALTER FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer, levels integer, start_after text, sort_order text, sort_column text, sort_column_after text) OWNER TO supabase_storage_admin;

--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: supabase_storage_admin
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


ALTER FUNCTION storage.update_updated_at_column() OWNER TO supabase_storage_admin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


ALTER TABLE auth.audit_log_entries OWNER TO supabase_auth_admin;

--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


ALTER TABLE auth.custom_oauth_providers OWNER TO supabase_auth_admin;

--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


ALTER TABLE auth.flow_state OWNER TO supabase_auth_admin;

--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE auth.identities OWNER TO supabase_auth_admin;

--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


ALTER TABLE auth.instances OWNER TO supabase_auth_admin;

--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


ALTER TABLE auth.mfa_amr_claims OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


ALTER TABLE auth.mfa_challenges OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


ALTER TABLE auth.mfa_factors OWNER TO supabase_auth_admin;

--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


ALTER TABLE auth.oauth_authorizations OWNER TO supabase_auth_admin;

--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


ALTER TABLE auth.oauth_client_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


ALTER TABLE auth.oauth_clients OWNER TO supabase_auth_admin;

--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


ALTER TABLE auth.oauth_consents OWNER TO supabase_auth_admin;

--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


ALTER TABLE auth.one_time_tokens OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


ALTER TABLE auth.refresh_tokens OWNER TO supabase_auth_admin;

--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: supabase_auth_admin
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE auth.refresh_tokens_id_seq OWNER TO supabase_auth_admin;

--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: supabase_auth_admin
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


ALTER TABLE auth.saml_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


ALTER TABLE auth.saml_relay_states OWNER TO supabase_auth_admin;

--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


ALTER TABLE auth.schema_migrations OWNER TO supabase_auth_admin;

--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


ALTER TABLE auth.sessions OWNER TO supabase_auth_admin;

--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


ALTER TABLE auth.sso_domains OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


ALTER TABLE auth.sso_providers OWNER TO supabase_auth_admin;

--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


ALTER TABLE auth.users OWNER TO supabase_auth_admin;

--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


ALTER TABLE auth.webauthn_challenges OWNER TO supabase_auth_admin;

--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: supabase_auth_admin
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


ALTER TABLE auth.webauthn_credentials OWNER TO supabase_auth_admin;

--
-- Name: Account; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Account" (
    id integer NOT NULL,
    name text NOT NULL,
    code text,
    type public."GlAccountType",
    "normalBalance" public."NormalBalance",
    description text,
    "isActive" boolean DEFAULT true NOT NULL,
    balance numeric(14,2) DEFAULT 0 NOT NULL,
    "parentId" integer,
    "groupId" integer,
    "personId" integer,
    "companyId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "creditLimit" numeric(14,2),
    "openingBalance" numeric(14,2),
    "openingBalanceType" public."EntryType",
    "openingBalanceDate" date
);


ALTER TABLE public."Account" OWNER TO postgres;

--
-- Name: AccountGroup; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."AccountGroup" (
    id integer NOT NULL,
    name text NOT NULL,
    type public."GroupType" NOT NULL,
    "parentId" integer,
    "sortOrder" integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL
);


ALTER TABLE public."AccountGroup" OWNER TO postgres;

--
-- Name: AccountGroup_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."AccountGroup_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."AccountGroup_id_seq" OWNER TO postgres;

--
-- Name: AccountGroup_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."AccountGroup_id_seq" OWNED BY public."AccountGroup".id;


--
-- Name: Account_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Account_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Account_id_seq" OWNER TO postgres;

--
-- Name: Account_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Account_id_seq" OWNED BY public."Account".id;


--
-- Name: BookPeriod; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."BookPeriod" (
    id integer NOT NULL,
    "fromDate" date NOT NULL,
    "toDate" date NOT NULL,
    "isLocked" boolean DEFAULT false NOT NULL,
    "lockedAt" timestamp(3) without time zone,
    "lockedById" integer,
    reason text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."BookPeriod" OWNER TO postgres;

--
-- Name: BookPeriod_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."BookPeriod_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."BookPeriod_id_seq" OWNER TO postgres;

--
-- Name: BookPeriod_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."BookPeriod_id_seq" OWNED BY public."BookPeriod".id;


--
-- Name: Branch; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Branch" (
    id text NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Branch" OWNER TO postgres;

--
-- Name: ChatMessage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ChatMessage" (
    id integer NOT NULL,
    "roomId" text NOT NULL,
    "senderUserId" integer,
    "messageType" public."ChatMessageType" DEFAULT 'USER'::public."ChatMessageType" NOT NULL,
    title text,
    body text NOT NULL,
    link text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ChatMessage" OWNER TO postgres;

--
-- Name: ChatMessage_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ChatMessage_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ChatMessage_id_seq" OWNER TO postgres;

--
-- Name: ChatMessage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ChatMessage_id_seq" OWNED BY public."ChatMessage".id;


--
-- Name: ChatRoom; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ChatRoom" (
    id text NOT NULL,
    key text NOT NULL,
    type public."ChatRoomType" NOT NULL,
    name text NOT NULL,
    "ownerUserId" integer,
    "roleId" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ChatRoom" OWNER TO postgres;

--
-- Name: ChatRoomMember; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ChatRoomMember" (
    id integer NOT NULL,
    "roomId" text NOT NULL,
    "userId" integer NOT NULL,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastReadAt" timestamp(3) without time zone
);


ALTER TABLE public."ChatRoomMember" OWNER TO postgres;

--
-- Name: ChatRoomMember_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ChatRoomMember_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ChatRoomMember_id_seq" OWNER TO postgres;

--
-- Name: ChatRoomMember_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ChatRoomMember_id_seq" OWNED BY public."ChatRoomMember".id;


--
-- Name: Company; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Company" (
    id integer NOT NULL,
    name text NOT NULL,
    address text,
    "companyReg" text,
    "taxId" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gstin text,
    "gstStateCode" text,
    "gstRegType" public."GstRegType",
    "financialYearFrom" date,
    "booksBeginningFrom" date
);


ALTER TABLE public."Company" OWNER TO postgres;

--
-- Name: Company_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Company_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Company_id_seq" OWNER TO postgres;

--
-- Name: Company_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Company_id_seq" OWNED BY public."Company".id;


--
-- Name: CrmLead; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."CrmLead" (
    id integer NOT NULL,
    "pipelineId" text NOT NULL,
    status text NOT NULL,
    title text NOT NULL,
    "contactName" text,
    phone text,
    email text,
    "companyName" text,
    "valuePaise" integer,
    source text,
    notes text,
    "personId" integer,
    "companyId" integer,
    "ownerUserId" integer,
    "createdById" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."CrmLead" OWNER TO postgres;

--
-- Name: CrmLead_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."CrmLead_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."CrmLead_id_seq" OWNER TO postgres;

--
-- Name: CrmLead_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."CrmLead_id_seq" OWNED BY public."CrmLead".id;


--
-- Name: Department; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Department" (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    "branchId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Department" OWNER TO postgres;

--
-- Name: Device; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Device" (
    id integer NOT NULL,
    type text NOT NULL,
    brand text NOT NULL,
    model text NOT NULL,
    problem text NOT NULL,
    "accountId" integer
);


ALTER TABLE public."Device" OWNER TO postgres;

--
-- Name: Device_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Device_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Device_id_seq" OWNER TO postgres;

--
-- Name: Device_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Device_id_seq" OWNED BY public."Device".id;


--
-- Name: Email; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Email" (
    id integer NOT NULL,
    email text NOT NULL,
    "personId" integer,
    "companyId" integer,
    label text,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Email" OWNER TO postgres;

--
-- Name: Email_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Email_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Email_id_seq" OWNER TO postgres;

--
-- Name: Email_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Email_id_seq" OWNED BY public."Email".id;


--
-- Name: InvBrand; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvBrand" (
    id integer NOT NULL,
    name text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."InvBrand" OWNER TO postgres;

--
-- Name: InvBrand_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvBrand_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvBrand_id_seq" OWNER TO postgres;

--
-- Name: InvBrand_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvBrand_id_seq" OWNED BY public."InvBrand".id;


--
-- Name: InvCategory; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvCategory" (
    id integer NOT NULL,
    name text NOT NULL,
    slug text,
    "parentId" integer,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."InvCategory" OWNER TO postgres;

--
-- Name: InvCategory_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvCategory_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvCategory_id_seq" OWNER TO postgres;

--
-- Name: InvCategory_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvCategory_id_seq" OWNED BY public."InvCategory".id;


--
-- Name: InvProduct; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvProduct" (
    id integer NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    "unitId" integer NOT NULL,
    "categoryId" integer,
    "groupId" integer,
    "brandId" integer,
    "warrantyTermId" integer,
    "modelNo" text,
    barcode1 text,
    barcode2 text,
    barcode3 text,
    ean1 text,
    ean2 text,
    ean3 text,
    upc1 text,
    upc2 text,
    upc3 text,
    notes text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    slug text,
    "shopSubheading" text,
    "shopDescription" text,
    "shopCategory" text,
    "pricePaise" integer,
    "mrpPaise" integer,
    "shopBadge" text,
    "imageUrl" text,
    "galleryJson" jsonb,
    "specsJson" jsonb,
    stock integer,
    "lowStockThreshold" integer DEFAULT 5 NOT NULL,
    "isListedInShop" boolean DEFAULT false NOT NULL,
    "costPaise" integer,
    "openingStock" numeric(10,3),
    "openingRate" numeric(14,2),
    "openingValue" numeric(14,2),
    "openingStockDate" date,
    "hsnCode" text,
    "gstRate" numeric(5,2),
    taxability public."Taxability"
);


ALTER TABLE public."InvProduct" OWNER TO postgres;

--
-- Name: InvProductGroup; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvProductGroup" (
    id integer NOT NULL,
    name text NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."InvProductGroup" OWNER TO postgres;

--
-- Name: InvProductGroup_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvProductGroup_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvProductGroup_id_seq" OWNER TO postgres;

--
-- Name: InvProductGroup_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvProductGroup_id_seq" OWNED BY public."InvProductGroup".id;


--
-- Name: InvProduct_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvProduct_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvProduct_id_seq" OWNER TO postgres;

--
-- Name: InvProduct_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvProduct_id_seq" OWNED BY public."InvProduct".id;


--
-- Name: InvStockLedger; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvStockLedger" (
    id integer NOT NULL,
    "productId" integer NOT NULL,
    "voucherId" integer NOT NULL,
    date date NOT NULL,
    "inQty" numeric(10,3) DEFAULT 0 NOT NULL,
    "outQty" numeric(10,3) DEFAULT 0 NOT NULL,
    rate numeric(14,2) NOT NULL,
    amount numeric(14,2) NOT NULL
);


ALTER TABLE public."InvStockLedger" OWNER TO postgres;

--
-- Name: InvStockLedger_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvStockLedger_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvStockLedger_id_seq" OWNER TO postgres;

--
-- Name: InvStockLedger_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvStockLedger_id_seq" OWNED BY public."InvStockLedger".id;


--
-- Name: InvUnit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvUnit" (
    id integer NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    decimals integer DEFAULT 0 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."InvUnit" OWNER TO postgres;

--
-- Name: InvUnit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvUnit_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvUnit_id_seq" OWNER TO postgres;

--
-- Name: InvUnit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvUnit_id_seq" OWNED BY public."InvUnit".id;


--
-- Name: InvWarrantyTerm; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."InvWarrantyTerm" (
    id integer NOT NULL,
    name text NOT NULL,
    description text,
    "durationMonths" integer,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."InvWarrantyTerm" OWNER TO postgres;

--
-- Name: InvWarrantyTerm_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."InvWarrantyTerm_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."InvWarrantyTerm_id_seq" OWNER TO postgres;

--
-- Name: InvWarrantyTerm_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."InvWarrantyTerm_id_seq" OWNED BY public."InvWarrantyTerm".id;


--
-- Name: Permission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Permission" (
    id text NOT NULL,
    label text NOT NULL,
    description text,
    module text DEFAULT 'core'::text NOT NULL
);


ALTER TABLE public."Permission" OWNER TO postgres;

--
-- Name: Person; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Person" (
    id integer NOT NULL,
    name text NOT NULL,
    address text,
    "agreedToTerms" boolean DEFAULT false NOT NULL,
    "agreedAt" timestamp(3) without time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    gstin text,
    "gstStateCode" text,
    "gstRegType" public."GstRegType"
);


ALTER TABLE public."Person" OWNER TO postgres;

--
-- Name: PersonCompany; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PersonCompany" (
    id integer NOT NULL,
    "personId" integer NOT NULL,
    "companyId" integer NOT NULL,
    role text,
    "linkedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "unlinkedAt" timestamp(3) without time zone
);


ALTER TABLE public."PersonCompany" OWNER TO postgres;

--
-- Name: PersonCompany_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."PersonCompany_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PersonCompany_id_seq" OWNER TO postgres;

--
-- Name: PersonCompany_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."PersonCompany_id_seq" OWNED BY public."PersonCompany".id;


--
-- Name: PersonPortalCredential; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."PersonPortalCredential" (
    id integer NOT NULL,
    "personId" integer NOT NULL,
    "phoneNormalized" text,
    "emailNormalized" text,
    "passwordHash" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."PersonPortalCredential" OWNER TO postgres;

--
-- Name: PersonPortalCredential_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."PersonPortalCredential_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PersonPortalCredential_id_seq" OWNER TO postgres;

--
-- Name: PersonPortalCredential_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."PersonPortalCredential_id_seq" OWNED BY public."PersonPortalCredential".id;


--
-- Name: Person_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Person_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Person_id_seq" OWNER TO postgres;

--
-- Name: Person_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Person_id_seq" OWNED BY public."Person".id;


--
-- Name: Phone; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Phone" (
    id integer NOT NULL,
    phone text NOT NULL,
    "personId" integer,
    "companyId" integer,
    label text,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Phone" OWNER TO postgres;

--
-- Name: Phone_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Phone_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Phone_id_seq" OWNER TO postgres;

--
-- Name: Phone_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Phone_id_seq" OWNED BY public."Phone".id;


--
-- Name: Pipeline; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Pipeline" (
    id text NOT NULL,
    name text NOT NULL,
    label text NOT NULL,
    description text,
    color text DEFAULT 'bg-gray-100 text-gray-600'::text NOT NULL,
    "isDefault" boolean DEFAULT false NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "order" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Pipeline" OWNER TO postgres;

--
-- Name: Post; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Post" (
    id text NOT NULL,
    title text NOT NULL,
    "branchId" text,
    "departmentId" text,
    "parentPostId" text,
    "roleTemplateId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Post" OWNER TO postgres;

--
-- Name: Role; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Role" (
    id text NOT NULL,
    label text NOT NULL,
    color text NOT NULL,
    rank integer DEFAULT 0 NOT NULL,
    "isSystem" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."Role" OWNER TO postgres;

--
-- Name: RolePermission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."RolePermission" (
    "roleId" text NOT NULL,
    "permissionId" text NOT NULL
);


ALTER TABLE public."RolePermission" OWNER TO postgres;

--
-- Name: ServiceCenter; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ServiceCenter" (
    id integer NOT NULL,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    address text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ServiceCenter" OWNER TO postgres;

--
-- Name: ServiceCenter_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ServiceCenter_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ServiceCenter_id_seq" OWNER TO postgres;

--
-- Name: ServiceCenter_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ServiceCenter_id_seq" OWNED BY public."ServiceCenter".id;


--
-- Name: ShopCoupon; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ShopCoupon" (
    id text NOT NULL,
    code text NOT NULL,
    "percentOff" integer,
    "flatPaise" integer,
    "isActive" boolean DEFAULT true NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ShopCoupon" OWNER TO postgres;

--
-- Name: ShopOrder; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ShopOrder" (
    id integer NOT NULL,
    status public."ShopOrderStatus" DEFAULT 'DRAFT'::public."ShopOrderStatus" NOT NULL,
    "orderSource" public."OrderSource" DEFAULT 'ONLINE'::public."OrderSource" NOT NULL,
    "pipelineId" text,
    "statusId" text,
    "accountId" integer,
    "personId" integer,
    "guestEmail" text,
    "guestPhone" text,
    "shippingName" text,
    "shippingAddress" jsonb,
    "totalPaise" integer DEFAULT 0 NOT NULL,
    "razorpayOrderId" text,
    "razorpayPaymentId" text,
    courier text,
    "trackingNumber" text,
    "sourceCouponId" text,
    "paidAt" timestamp(3) without time zone,
    "packedAt" timestamp(3) without time zone,
    "shippedAt" timestamp(3) without time zone,
    "deliveredAt" timestamp(3) without time zone,
    "refundedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."ShopOrder" OWNER TO postgres;

--
-- Name: ShopOrderLine; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."ShopOrderLine" (
    id integer NOT NULL,
    "orderId" integer NOT NULL,
    "productId" integer NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    "unitPricePaise" integer NOT NULL
);


ALTER TABLE public."ShopOrderLine" OWNER TO postgres;

--
-- Name: ShopOrderLine_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ShopOrderLine_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ShopOrderLine_id_seq" OWNER TO postgres;

--
-- Name: ShopOrderLine_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ShopOrderLine_id_seq" OWNED BY public."ShopOrderLine".id;


--
-- Name: ShopOrder_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."ShopOrder_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ShopOrder_id_seq" OWNER TO postgres;

--
-- Name: ShopOrder_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."ShopOrder_id_seq" OWNED BY public."ShopOrder".id;


--
-- Name: StatusTransition; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."StatusTransition" (
    id integer NOT NULL,
    "fromStatusId" text NOT NULL,
    "toStatusId" text NOT NULL
);


ALTER TABLE public."StatusTransition" OWNER TO postgres;

--
-- Name: StatusTransition_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."StatusTransition_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."StatusTransition_id_seq" OWNER TO postgres;

--
-- Name: StatusTransition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."StatusTransition_id_seq" OWNED BY public."StatusTransition".id;


--
-- Name: SubStatusGroup; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."SubStatusGroup" (
    id text NOT NULL,
    label text NOT NULL,
    "order" integer DEFAULT 0 NOT NULL
);


ALTER TABLE public."SubStatusGroup" OWNER TO postgres;

--
-- Name: SubStatusTransition; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."SubStatusTransition" (
    id integer NOT NULL,
    "fromSubStatusId" text,
    "toSubStatusId" text NOT NULL
);


ALTER TABLE public."SubStatusTransition" OWNER TO postgres;

--
-- Name: SubStatusTransition_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."SubStatusTransition_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SubStatusTransition_id_seq" OWNER TO postgres;

--
-- Name: SubStatusTransition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."SubStatusTransition_id_seq" OWNED BY public."SubStatusTransition".id;


--
-- Name: Ticket; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Ticket" (
    id integer NOT NULL,
    "sourceShopOrderId" integer,
    "pipelineId" text,
    status text DEFAULT 'S1'::text NOT NULL,
    priority public."Priority" DEFAULT 'MEDIUM'::public."Priority" NOT NULL,
    notes text,
    "accessInfo" text,
    "estimatedCost" double precision,
    "deviceId" integer NOT NULL,
    escalated boolean DEFAULT false NOT NULL,
    "escalatedAt" timestamp(3) without time zone,
    "escalationType" public."EscalationType",
    "expectedReturn" timestamp(3) without time zone,
    "receivedBackAt" timestamp(3) without time zone,
    "externalRef" text,
    "serviceCenterId" integer,
    "subStatusId" text,
    "isWarranty" boolean DEFAULT false NOT NULL,
    "warrantyStatus" public."WarrantyStatus" DEFAULT 'NONE'::public."WarrantyStatus" NOT NULL,
    "warrantyRef" text,
    "purchaseDate" timestamp(3) without time zone,
    "voidReason" text,
    "primaryOwnerId" integer,
    "billingAccountId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Ticket" OWNER TO postgres;

--
-- Name: TicketLog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."TicketLog" (
    id integer NOT NULL,
    "ticketId" integer NOT NULL,
    status text NOT NULL,
    note text,
    "userId" integer NOT NULL,
    "subStatusId" text,
    visibility public."LogVisibility" DEFAULT 'INTERNAL'::public."LogVisibility" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."TicketLog" OWNER TO postgres;

--
-- Name: TicketLog_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."TicketLog_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."TicketLog_id_seq" OWNER TO postgres;

--
-- Name: TicketLog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."TicketLog_id_seq" OWNED BY public."TicketLog".id;


--
-- Name: TicketParticipant; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."TicketParticipant" (
    id integer NOT NULL,
    "ticketId" integer NOT NULL,
    "userId" integer NOT NULL,
    "addedById" integer NOT NULL,
    "addedForRole" text,
    "addedBySubStatusId" text,
    "removedAt" timestamp(3) without time zone,
    "removedBySubStatusId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."TicketParticipant" OWNER TO postgres;

--
-- Name: TicketParticipant_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."TicketParticipant_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."TicketParticipant_id_seq" OWNER TO postgres;

--
-- Name: TicketParticipant_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."TicketParticipant_id_seq" OWNED BY public."TicketParticipant".id;


--
-- Name: TicketStatus; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."TicketStatus" (
    id text NOT NULL,
    label text NOT NULL,
    color text NOT NULL,
    "order" integer NOT NULL,
    "isTerminal" boolean DEFAULT false NOT NULL,
    "isEntryPoint" boolean DEFAULT false NOT NULL,
    "allowedRoles" text[],
    "notifyRoles" text[],
    "actionLabel" text,
    "warrantyScope" text DEFAULT 'any'::text NOT NULL,
    "pipelineId" text
);


ALTER TABLE public."TicketStatus" OWNER TO postgres;

--
-- Name: TicketSubStatus; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."TicketSubStatus" (
    id text NOT NULL,
    label text NOT NULL,
    color text DEFAULT 'bg-gray-100 text-gray-600'::text NOT NULL,
    "group" text NOT NULL,
    "order" integer NOT NULL,
    "applicableStatusIds" text[],
    "allowedRoles" text[],
    "notifyRoles" text[],
    "triggerMap" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "actionLabel" text,
    "autoRevertOnClear" boolean DEFAULT true NOT NULL,
    "handoffRole" text,
    "warrantyScope" text DEFAULT 'any'::text NOT NULL,
    "groupId" text,
    "pipelineId" text
);


ALTER TABLE public."TicketSubStatus" OWNER TO postgres;

--
-- Name: Ticket_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Ticket_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Ticket_id_seq" OWNER TO postgres;

--
-- Name: Ticket_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Ticket_id_seq" OWNED BY public."Ticket".id;


--
-- Name: User; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."User" (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    password text NOT NULL,
    role text DEFAULT 'R2'::text NOT NULL,
    title text,
    scope public."UserScope" DEFAULT 'OWN'::public."UserScope" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "managerId" integer,
    "avatarUrl" text,
    "coverUrl" text,
    phone text,
    birthday timestamp(3) without time zone,
    bio text,
    "linkedIn" text,
    twitter text,
    instagram text,
    facebook text
);


ALTER TABLE public."User" OWNER TO postgres;

--
-- Name: UserPermission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."UserPermission" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "permissionId" text NOT NULL,
    type public."OverrideType" NOT NULL,
    reason text,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."UserPermission" OWNER TO postgres;

--
-- Name: UserPermission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."UserPermission_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."UserPermission_id_seq" OWNER TO postgres;

--
-- Name: UserPermission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."UserPermission_id_seq" OWNED BY public."UserPermission".id;


--
-- Name: UserPost; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."UserPost" (
    "userId" integer NOT NULL,
    "postId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."UserPost" OWNER TO postgres;

--
-- Name: User_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."User_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."User_id_seq" OWNER TO postgres;

--
-- Name: User_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."User_id_seq" OWNED BY public."User".id;


--
-- Name: Voucher; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."Voucher" (
    id integer NOT NULL,
    type public."VoucherType" NOT NULL,
    reference text NOT NULL,
    date date NOT NULL,
    status public."VoucherStatus" DEFAULT 'DRAFT'::public."VoucherStatus" NOT NULL,
    narration text,
    "partyAccountId" integer,
    "partyName" text,
    "dueDate" date,
    "paymentMode" text,
    "placeOfSupply" text,
    subtotal numeric(14,2) DEFAULT 0 NOT NULL,
    "taxAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "shippingAmt" numeric(14,2) DEFAULT 0 NOT NULL,
    "roundOff" numeric(14,2) DEFAULT 0 NOT NULL,
    "totalAmount" numeric(14,2) DEFAULT 0 NOT NULL,
    "amountPaid" numeric(14,2) DEFAULT 0 NOT NULL,
    "editVersion" integer DEFAULT 0 NOT NULL,
    "lastEditedAt" timestamp(3) without time zone,
    "lastEditedById" integer,
    "shopOrderId" integer,
    "ticketId" integer,
    "postedAt" timestamp(3) without time zone,
    "cancelledAt" timestamp(3) without time zone,
    "cancelledById" integer,
    "cancelReason" text,
    "deletedAt" timestamp(3) without time zone,
    "deletedById" integer,
    "deleteReason" text,
    "createdById" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    source text
);


ALTER TABLE public."Voucher" OWNER TO postgres;

--
-- Name: VoucherAudit; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."VoucherAudit" (
    id integer NOT NULL,
    "voucherId" integer,
    "originalRef" text NOT NULL,
    action text NOT NULL,
    reason text,
    snapshot jsonb NOT NULL,
    "actorId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."VoucherAudit" OWNER TO postgres;

--
-- Name: VoucherAudit_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."VoucherAudit_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VoucherAudit_id_seq" OWNER TO postgres;

--
-- Name: VoucherAudit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."VoucherAudit_id_seq" OWNED BY public."VoucherAudit".id;


--
-- Name: VoucherCounter; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."VoucherCounter" (
    id integer NOT NULL,
    "seriesId" integer NOT NULL,
    "periodKey" text NOT NULL,
    "lastNumber" integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."VoucherCounter" OWNER TO postgres;

--
-- Name: VoucherCounter_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."VoucherCounter_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VoucherCounter_id_seq" OWNER TO postgres;

--
-- Name: VoucherCounter_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."VoucherCounter_id_seq" OWNED BY public."VoucherCounter".id;


--
-- Name: VoucherEditLog; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."VoucherEditLog" (
    id integer NOT NULL,
    "voucherId" integer NOT NULL,
    version integer NOT NULL,
    "editedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "editedById" integer NOT NULL,
    reason text,
    before jsonb NOT NULL,
    after jsonb NOT NULL,
    "ipAddress" text,
    "userAgent" text
);


ALTER TABLE public."VoucherEditLog" OWNER TO postgres;

--
-- Name: VoucherEditLog_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."VoucherEditLog_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VoucherEditLog_id_seq" OWNER TO postgres;

--
-- Name: VoucherEditLog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."VoucherEditLog_id_seq" OWNED BY public."VoucherEditLog".id;


--
-- Name: VoucherLine; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."VoucherLine" (
    id integer NOT NULL,
    "voucherId" integer NOT NULL,
    "accountId" integer NOT NULL,
    type public."EntryType" NOT NULL,
    amount numeric(14,2) NOT NULL,
    description text,
    "productId" integer,
    quantity numeric(10,3),
    rate numeric(14,2),
    "discountPct" numeric(5,2),
    "discountAmt" numeric(14,2),
    "taxRate" numeric(5,2),
    "taxAmount" numeric(14,2)
);


ALTER TABLE public."VoucherLine" OWNER TO postgres;

--
-- Name: VoucherLineBillRef; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."VoucherLineBillRef" (
    id integer NOT NULL,
    "voucherLineId" integer NOT NULL,
    "partyAccountId" integer NOT NULL,
    "billRef" text NOT NULL,
    method public."BillRefMethod" NOT NULL,
    amount numeric(14,2) NOT NULL,
    "dueDate" date,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."VoucherLineBillRef" OWNER TO postgres;

--
-- Name: VoucherLineBillRef_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."VoucherLineBillRef_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VoucherLineBillRef_id_seq" OWNER TO postgres;

--
-- Name: VoucherLineBillRef_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."VoucherLineBillRef_id_seq" OWNED BY public."VoucherLineBillRef".id;


--
-- Name: VoucherLine_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."VoucherLine_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VoucherLine_id_seq" OWNER TO postgres;

--
-- Name: VoucherLine_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."VoucherLine_id_seq" OWNED BY public."VoucherLine".id;


--
-- Name: VoucherSeries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."VoucherSeries" (
    id integer NOT NULL,
    "seriesKey" text NOT NULL,
    label text NOT NULL,
    format text DEFAULT '{KEY}-{YYYY}-{####}'::text NOT NULL,
    "startNumber" integer DEFAULT 1 NOT NULL,
    "resetPolicy" public."ResetPolicy" DEFAULT 'YEARLY'::public."ResetPolicy" NOT NULL,
    "fyStartMonth" integer DEFAULT 4 NOT NULL,
    "isActive" boolean DEFAULT true NOT NULL,
    "allowManualOverride" boolean DEFAULT false NOT NULL,
    "isGstScoped" boolean DEFAULT false NOT NULL,
    notes text,
    "updatedById" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."VoucherSeries" OWNER TO postgres;

--
-- Name: VoucherSeries_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."VoucherSeries_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VoucherSeries_id_seq" OWNER TO postgres;

--
-- Name: VoucherSeries_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."VoucherSeries_id_seq" OWNED BY public."VoucherSeries".id;


--
-- Name: Voucher_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."Voucher_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Voucher_id_seq" OWNER TO postgres;

--
-- Name: Voucher_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."Voucher_id_seq" OWNED BY public."Voucher".id;


--
-- Name: WallPost; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."WallPost" (
    id integer NOT NULL,
    "wallUserId" integer NOT NULL,
    "authorId" integer NOT NULL,
    body text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."WallPost" OWNER TO postgres;

--
-- Name: WallPost_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public."WallPost_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."WallPost_id_seq" OWNER TO postgres;

--
-- Name: WallPost_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public."WallPost_id_seq" OWNED BY public."WallPost".id;


--
-- Name: _BranchToUser; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."_BranchToUser" (
    "A" text NOT NULL,
    "B" integer NOT NULL
);


ALTER TABLE public."_BranchToUser" OWNER TO postgres;

--
-- Name: _DepartmentToUser; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public."_DepartmentToUser" (
    "A" text NOT NULL,
    "B" integer NOT NULL
);


ALTER TABLE public."_DepartmentToUser" OWNER TO postgres;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO postgres;

--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
)
PARTITION BY RANGE (inserted_at);


ALTER TABLE realtime.messages OWNER TO supabase_realtime_admin;

--
-- Name: messages_2026_05_05; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.messages_2026_05_05 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE realtime.messages_2026_05_05 OWNER TO supabase_admin;

--
-- Name: messages_2026_05_06; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.messages_2026_05_06 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE realtime.messages_2026_05_06 OWNER TO supabase_admin;

--
-- Name: messages_2026_05_07; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.messages_2026_05_07 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE realtime.messages_2026_05_07 OWNER TO supabase_admin;

--
-- Name: messages_2026_05_08; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.messages_2026_05_08 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE realtime.messages_2026_05_08 OWNER TO supabase_admin;

--
-- Name: messages_2026_05_09; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.messages_2026_05_09 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE realtime.messages_2026_05_09 OWNER TO supabase_admin;

--
-- Name: messages_2026_05_10; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.messages_2026_05_10 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE realtime.messages_2026_05_10 OWNER TO supabase_admin;

--
-- Name: messages_2026_05_11; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.messages_2026_05_11 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


ALTER TABLE realtime.messages_2026_05_11 OWNER TO supabase_admin;

--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


ALTER TABLE realtime.schema_migrations OWNER TO supabase_admin;

--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: supabase_admin
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


ALTER TABLE realtime.subscription OWNER TO supabase_admin;

--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL
);


ALTER TABLE storage.buckets OWNER TO supabase_storage_admin;

--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


ALTER TABLE storage.buckets_analytics OWNER TO supabase_storage_admin;

--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.buckets_vectors OWNER TO supabase_storage_admin;

--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE storage.migrations OWNER TO supabase_storage_admin;

--
-- Name: objects; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb
);


ALTER TABLE storage.objects OWNER TO supabase_storage_admin;

--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: supabase_storage_admin
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


ALTER TABLE storage.s3_multipart_uploads OWNER TO supabase_storage_admin;

--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.s3_multipart_uploads_parts OWNER TO supabase_storage_admin;

--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: supabase_storage_admin
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE storage.vector_indexes OWNER TO supabase_storage_admin;

--
-- Name: messages_2026_05_05; Type: TABLE ATTACH; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_05 FOR VALUES FROM ('2026-05-05 00:00:00') TO ('2026-05-06 00:00:00');


--
-- Name: messages_2026_05_06; Type: TABLE ATTACH; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_06 FOR VALUES FROM ('2026-05-06 00:00:00') TO ('2026-05-07 00:00:00');


--
-- Name: messages_2026_05_07; Type: TABLE ATTACH; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_07 FOR VALUES FROM ('2026-05-07 00:00:00') TO ('2026-05-08 00:00:00');


--
-- Name: messages_2026_05_08; Type: TABLE ATTACH; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_08 FOR VALUES FROM ('2026-05-08 00:00:00') TO ('2026-05-09 00:00:00');


--
-- Name: messages_2026_05_09; Type: TABLE ATTACH; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_09 FOR VALUES FROM ('2026-05-09 00:00:00') TO ('2026-05-10 00:00:00');


--
-- Name: messages_2026_05_10; Type: TABLE ATTACH; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_10 FOR VALUES FROM ('2026-05-10 00:00:00') TO ('2026-05-11 00:00:00');


--
-- Name: messages_2026_05_11; Type: TABLE ATTACH; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_05_11 FOR VALUES FROM ('2026-05-11 00:00:00') TO ('2026-05-12 00:00:00');


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: Account id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account" ALTER COLUMN id SET DEFAULT nextval('public."Account_id_seq"'::regclass);


--
-- Name: AccountGroup id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AccountGroup" ALTER COLUMN id SET DEFAULT nextval('public."AccountGroup_id_seq"'::regclass);


--
-- Name: BookPeriod id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BookPeriod" ALTER COLUMN id SET DEFAULT nextval('public."BookPeriod_id_seq"'::regclass);


--
-- Name: ChatMessage id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatMessage" ALTER COLUMN id SET DEFAULT nextval('public."ChatMessage_id_seq"'::regclass);


--
-- Name: ChatRoomMember id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatRoomMember" ALTER COLUMN id SET DEFAULT nextval('public."ChatRoomMember_id_seq"'::regclass);


--
-- Name: Company id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Company" ALTER COLUMN id SET DEFAULT nextval('public."Company_id_seq"'::regclass);


--
-- Name: CrmLead id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead" ALTER COLUMN id SET DEFAULT nextval('public."CrmLead_id_seq"'::regclass);


--
-- Name: Device id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Device" ALTER COLUMN id SET DEFAULT nextval('public."Device_id_seq"'::regclass);


--
-- Name: Email id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Email" ALTER COLUMN id SET DEFAULT nextval('public."Email_id_seq"'::regclass);


--
-- Name: InvBrand id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvBrand" ALTER COLUMN id SET DEFAULT nextval('public."InvBrand_id_seq"'::regclass);


--
-- Name: InvCategory id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvCategory" ALTER COLUMN id SET DEFAULT nextval('public."InvCategory_id_seq"'::regclass);


--
-- Name: InvProduct id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProduct" ALTER COLUMN id SET DEFAULT nextval('public."InvProduct_id_seq"'::regclass);


--
-- Name: InvProductGroup id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProductGroup" ALTER COLUMN id SET DEFAULT nextval('public."InvProductGroup_id_seq"'::regclass);


--
-- Name: InvStockLedger id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvStockLedger" ALTER COLUMN id SET DEFAULT nextval('public."InvStockLedger_id_seq"'::regclass);


--
-- Name: InvUnit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvUnit" ALTER COLUMN id SET DEFAULT nextval('public."InvUnit_id_seq"'::regclass);


--
-- Name: InvWarrantyTerm id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvWarrantyTerm" ALTER COLUMN id SET DEFAULT nextval('public."InvWarrantyTerm_id_seq"'::regclass);


--
-- Name: Person id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Person" ALTER COLUMN id SET DEFAULT nextval('public."Person_id_seq"'::regclass);


--
-- Name: PersonCompany id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PersonCompany" ALTER COLUMN id SET DEFAULT nextval('public."PersonCompany_id_seq"'::regclass);


--
-- Name: PersonPortalCredential id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PersonPortalCredential" ALTER COLUMN id SET DEFAULT nextval('public."PersonPortalCredential_id_seq"'::regclass);


--
-- Name: Phone id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Phone" ALTER COLUMN id SET DEFAULT nextval('public."Phone_id_seq"'::regclass);


--
-- Name: ServiceCenter id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ServiceCenter" ALTER COLUMN id SET DEFAULT nextval('public."ServiceCenter_id_seq"'::regclass);


--
-- Name: ShopOrder id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrder" ALTER COLUMN id SET DEFAULT nextval('public."ShopOrder_id_seq"'::regclass);


--
-- Name: ShopOrderLine id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrderLine" ALTER COLUMN id SET DEFAULT nextval('public."ShopOrderLine_id_seq"'::regclass);


--
-- Name: StatusTransition id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StatusTransition" ALTER COLUMN id SET DEFAULT nextval('public."StatusTransition_id_seq"'::regclass);


--
-- Name: SubStatusTransition id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SubStatusTransition" ALTER COLUMN id SET DEFAULT nextval('public."SubStatusTransition_id_seq"'::regclass);


--
-- Name: Ticket id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket" ALTER COLUMN id SET DEFAULT nextval('public."Ticket_id_seq"'::regclass);


--
-- Name: TicketLog id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketLog" ALTER COLUMN id SET DEFAULT nextval('public."TicketLog_id_seq"'::regclass);


--
-- Name: TicketParticipant id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketParticipant" ALTER COLUMN id SET DEFAULT nextval('public."TicketParticipant_id_seq"'::regclass);


--
-- Name: User id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User" ALTER COLUMN id SET DEFAULT nextval('public."User_id_seq"'::regclass);


--
-- Name: UserPermission id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserPermission" ALTER COLUMN id SET DEFAULT nextval('public."UserPermission_id_seq"'::regclass);


--
-- Name: Voucher id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher" ALTER COLUMN id SET DEFAULT nextval('public."Voucher_id_seq"'::regclass);


--
-- Name: VoucherAudit id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherAudit" ALTER COLUMN id SET DEFAULT nextval('public."VoucherAudit_id_seq"'::regclass);


--
-- Name: VoucherCounter id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherCounter" ALTER COLUMN id SET DEFAULT nextval('public."VoucherCounter_id_seq"'::regclass);


--
-- Name: VoucherEditLog id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherEditLog" ALTER COLUMN id SET DEFAULT nextval('public."VoucherEditLog_id_seq"'::regclass);


--
-- Name: VoucherLine id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLine" ALTER COLUMN id SET DEFAULT nextval('public."VoucherLine_id_seq"'::regclass);


--
-- Name: VoucherLineBillRef id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLineBillRef" ALTER COLUMN id SET DEFAULT nextval('public."VoucherLineBillRef_id_seq"'::regclass);


--
-- Name: VoucherSeries id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherSeries" ALTER COLUMN id SET DEFAULT nextval('public."VoucherSeries_id_seq"'::regclass);


--
-- Name: WallPost id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WallPost" ALTER COLUMN id SET DEFAULT nextval('public."WallPost_id_seq"'::regclass);


--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.audit_log_entries (instance_id, id, payload, created_at, ip_address) FROM stdin;
\.


--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.custom_oauth_providers (id, provider_type, identifier, name, client_id, client_secret, acceptable_client_ids, scopes, pkce_enabled, attribute_mapping, authorization_params, enabled, email_optional, issuer, discovery_url, skip_nonce_check, cached_discovery, discovery_cached_at, authorization_url, token_url, userinfo_url, jwks_uri, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.flow_state (id, user_id, auth_code, code_challenge_method, code_challenge, provider_type, provider_access_token, provider_refresh_token, created_at, updated_at, authentication_method, auth_code_issued_at, invite_token, referrer, oauth_client_state_id, linking_target_id, email_optional) FROM stdin;
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, id) FROM stdin;
\.


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.instances (id, uuid, raw_base_config, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.mfa_amr_claims (session_id, created_at, updated_at, authentication_method, id) FROM stdin;
\.


--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.mfa_challenges (id, factor_id, created_at, verified_at, ip_address, otp_code, web_authn_session_data) FROM stdin;
\.


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret, phone, last_challenged_at, web_authn_credential, web_authn_aaguid, last_webauthn_challenge_data) FROM stdin;
\.


--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.oauth_authorizations (id, authorization_id, client_id, user_id, redirect_uri, scope, state, resource, code_challenge, code_challenge_method, response_type, status, authorization_code, created_at, expires_at, approved_at, nonce) FROM stdin;
\.


--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.oauth_client_states (id, provider_type, code_verifier, created_at) FROM stdin;
\.


--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.oauth_clients (id, client_secret_hash, registration_type, redirect_uris, grant_types, client_name, client_uri, logo_uri, created_at, updated_at, deleted_at, client_type, token_endpoint_auth_method) FROM stdin;
\.


--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.oauth_consents (id, user_id, client_id, scopes, granted_at, revoked_at) FROM stdin;
\.


--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.refresh_tokens (instance_id, id, token, user_id, revoked, created_at, updated_at, parent, session_id) FROM stdin;
\.


--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.saml_providers (id, sso_provider_id, entity_id, metadata_xml, metadata_url, attribute_mapping, created_at, updated_at, name_id_format) FROM stdin;
\.


--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.saml_relay_states (id, sso_provider_id, request_id, for_email, redirect_to, created_at, updated_at, flow_state_id) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.schema_migrations (version) FROM stdin;
20171026211738
20171026211808
20171026211834
20180103212743
20180108183307
20180119214651
20180125194653
00
20210710035447
20210722035447
20210730183235
20210909172000
20210927181326
20211122151130
20211124214934
20211202183645
20220114185221
20220114185340
20220224000811
20220323170000
20220429102000
20220531120530
20220614074223
20220811173540
20221003041349
20221003041400
20221011041400
20221020193600
20221021073300
20221021082433
20221027105023
20221114143122
20221114143410
20221125140132
20221208132122
20221215195500
20221215195800
20221215195900
20230116124310
20230116124412
20230131181311
20230322519590
20230402418590
20230411005111
20230508135423
20230523124323
20230818113222
20230914180801
20231027141322
20231114161723
20231117164230
20240115144230
20240214120130
20240306115329
20240314092811
20240427152123
20240612123726
20240729123726
20240802193726
20240806073726
20241009103726
20250717082212
20250731150234
20250804100000
20250901200500
20250903112500
20250904133000
20250925093508
20251007112900
20251104100000
20251111201300
20251201000000
20260115000000
20260121000000
20260219120000
20260302000000
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.sessions (id, user_id, created_at, updated_at, factor_id, aal, not_after, refreshed_at, user_agent, ip, tag, oauth_client_id, refresh_token_hmac_key, refresh_token_counter, scopes) FROM stdin;
\.


--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.sso_domains (id, sso_provider_id, domain, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.sso_providers (id, resource_id, created_at, updated_at, disabled) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, invited_at, confirmation_token, confirmation_sent_at, recovery_token, recovery_sent_at, email_change_token_new, email_change, email_change_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, created_at, updated_at, phone, phone_confirmed_at, phone_change, phone_change_token, phone_change_sent_at, email_change_token_current, email_change_confirm_status, banned_until, reauthentication_token, reauthentication_sent_at, is_sso_user, deleted_at, is_anonymous) FROM stdin;
\.


--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.webauthn_challenges (id, user_id, challenge_type, session_data, created_at, expires_at) FROM stdin;
\.


--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY auth.webauthn_credentials (id, user_id, credential_id, public_key, attestation_type, aaguid, sign_count, transports, backup_eligible, backed_up, friendly_name, created_at, updated_at, last_used_at) FROM stdin;
\.


--
-- Data for Name: Account; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Account" (id, name, code, type, "normalBalance", description, "isActive", balance, "parentId", "groupId", "personId", "companyId", "createdAt", "creditLimit", "openingBalance", "openingBalanceType", "openingBalanceDate") FROM stdin;
3	Accounts Receivable	1100	ASSET	DEBIT	Amounts owed by customers	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:15.565	\N	\N	\N	\N
4	Parts Inventory	1200	ASSET	DEBIT	Spare parts and components in stock	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:15.676	\N	\N	\N	\N
5	Prepaid Expenses	1300	ASSET	DEBIT	Prepaid rent, insurance, subscriptions	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:15.795	\N	\N	\N	\N
6	Accounts Payable	2000	LIABILITY	CREDIT	Amounts owed to suppliers	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:15.926	\N	\N	\N	\N
8	Accrued Expenses	2200	LIABILITY	CREDIT	Expenses incurred but not yet paid	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:16.193	\N	\N	\N	\N
9	Owner's Capital	3000	EQUITY	CREDIT	Owner's investment in the business	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:16.313	\N	\N	\N	\N
10	Retained Earnings	3100	EQUITY	CREDIT	Accumulated profits carried forward	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:16.433	\N	\N	\N	\N
12	Parts Revenue	4100	REVENUE	CREDIT	Income from parts sales	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:16.642	\N	\N	\N	\N
13	Shop Sales Revenue	4150	REVENUE	CREDIT	Income from ecommerce and walk-in product sales	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:16.755	\N	\N	\N	\N
14	Warranty Revenue	4200	REVENUE	CREDIT	Income from warranty claim work	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:16.85	\N	\N	\N	\N
15	Other Revenue	4900	REVENUE	CREDIT	Miscellaneous income	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:16.94	\N	\N	\N	\N
16	Cost of Parts Sold	5000	EXPENSE	DEBIT	Cost of parts used in repairs	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:17.043	\N	\N	\N	\N
17	Rent Expense	6000	EXPENSE	DEBIT	Shop / office rent	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:17.163	\N	\N	\N	\N
18	Utilities Expense	6100	EXPENSE	DEBIT	Electricity, water, internet	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:17.283	\N	\N	\N	\N
19	Salaries Expense	6200	EXPENSE	DEBIT	Staff wages and salaries	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:17.403	\N	\N	\N	\N
20	Tools & Equipment	6300	EXPENSE	DEBIT	Tools, equipment and small asset purchases	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:17.513	\N	\N	\N	\N
22	Walk-in Cash Customer	CASH-WALKIN	ASSET	DEBIT	Generic account for unregistered walk-in cash sales	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:17.772	\N	\N	\N	\N
1	Cash	1000	ASSET	DEBIT	Physical cash and petty cash	t	0.00	\N	27	\N	\N	2026-05-08 11:53:15.318	\N	\N	\N	\N
23	Petty Cash	\N	ASSET	DEBIT	\N	t	0.00	\N	27	\N	\N	2026-05-08 11:53:32.278	\N	\N	\N	\N
24	Profit & Loss A/c	\N	EQUITY	CREDIT	\N	t	0.00	\N	\N	\N	\N	2026-05-08 11:53:32.444	\N	\N	\N	\N
25	Capital	\N	LIABILITY	CREDIT	\N	t	0.00	\N	1	\N	\N	2026-05-08 11:53:32.718	\N	\N	\N	\N
26	Drawings	\N	LIABILITY	DEBIT	\N	t	0.00	\N	1	\N	\N	2026-05-08 11:53:32.999	\N	\N	\N	\N
27	Current Stock	\N	ASSET	DEBIT	\N	t	0.00	\N	23	\N	\N	2026-05-08 11:53:33.259	\N	\N	\N	\N
28	Sales A/c	\N	REVENUE	CREDIT	\N	t	0.00	\N	10	\N	\N	2026-05-08 11:53:33.539	\N	\N	\N	\N
30	CGST	\N	LIABILITY	CREDIT	\N	t	0.00	\N	20	\N	\N	2026-05-08 11:53:34.094	\N	\N	\N	\N
31	SGST	\N	LIABILITY	CREDIT	\N	t	0.00	\N	20	\N	\N	2026-05-08 11:53:34.344	\N	\N	\N	\N
32	IGST	\N	LIABILITY	CREDIT	\N	t	0.00	\N	20	\N	\N	2026-05-08 11:53:34.608	\N	\N	\N	\N
33	TDS	\N	LIABILITY	CREDIT	\N	t	0.00	\N	20	\N	\N	2026-05-08 11:53:34.878	\N	\N	\N	\N
34	Salary & Wages	\N	EXPENSE	DEBIT	\N	t	0.00	\N	15	\N	\N	2026-05-08 11:53:35.149	\N	\N	\N	\N
35	Rent	\N	EXPENSE	DEBIT	\N	t	0.00	\N	15	\N	\N	2026-05-08 11:53:35.429	\N	\N	\N	\N
36	Electricity Charges	\N	EXPENSE	DEBIT	\N	t	0.00	\N	15	\N	\N	2026-05-08 11:53:35.718	\N	\N	\N	\N
37	Telephone / Internet	\N	EXPENSE	DEBIT	\N	t	0.00	\N	15	\N	\N	2026-05-08 11:53:36.019	\N	\N	\N	\N
38	Discount Allowed	\N	EXPENSE	DEBIT	\N	t	0.00	\N	15	\N	\N	2026-05-08 11:53:36.299	\N	\N	\N	\N
39	Bad Debts	\N	EXPENSE	DEBIT	\N	t	0.00	\N	15	\N	\N	2026-05-08 11:53:36.599	\N	\N	\N	\N
21	Miscellaneous Expense	6900	EXPENSE	DEBIT	Other business expenses	t	0.00	\N	15	\N	\N	2026-05-08 11:53:17.636	\N	\N	\N	\N
40	Repair & Maintenance	\N	EXPENSE	DEBIT	\N	t	0.00	\N	13	\N	\N	2026-05-08 11:53:37.189	\N	\N	\N	\N
41	Consumables & Spares	\N	EXPENSE	DEBIT	\N	t	0.00	\N	13	\N	\N	2026-05-08 11:53:37.459	\N	\N	\N	\N
42	Service Charges Income	\N	REVENUE	CREDIT	\N	t	0.00	\N	12	\N	\N	2026-05-08 11:53:37.749	\N	\N	\N	\N
43	Discount Received	\N	REVENUE	CREDIT	\N	t	0.00	\N	14	\N	\N	2026-05-08 11:53:38.038	\N	\N	\N	\N
44	Round Off	\N	REVENUE	CREDIT	\N	t	0.00	\N	14	\N	\N	2026-05-08 11:53:38.318	\N	\N	\N	\N
45	Difference in Opening Balances	\N	LIABILITY	CREDIT	\N	t	0.00	\N	9	\N	\N	2026-05-08 11:53:38.589	\N	\N	\N	\N
50	SAMPLE EastWest Hardware A/c	\N	LIABILITY	CREDIT	\N	t	0.00	\N	22	\N	2	2026-05-08 11:53:59.026	\N	\N	\N	\N
29	Purchase A/c	\N	EXPENSE	DEBIT	\N	t	40000.00	\N	11	\N	\N	2026-05-08 11:53:33.809	\N	\N	\N	\N
49	SAMPLE Delta Distributors A/c	\N	LIABILITY	CREDIT	\N	t	40000.00	\N	22	\N	1	2026-05-08 11:53:58.795	\N	\N	\N	\N
47	SAMPLE Bharat IT Solutions A/c	\N	ASSET	DEBIT	\N	t	5900.00	\N	26	2	\N	2026-05-08 11:53:58.335	\N	\N	\N	\N
11	Service Revenue	4000	REVENUE	CREDIT	Income from repair and service work	t	17000.00	\N	\N	\N	\N	2026-05-08 11:53:16.536	\N	\N	\N	\N
7	Tax Payable	2100	LIABILITY	CREDIT	VAT / sales tax collected from customers	t	3060.00	\N	\N	\N	\N	2026-05-08 11:53:16.064	\N	\N	\N	\N
48	SAMPLE Coastal Systems A/c	\N	ASSET	DEBIT	\N	t	9160.00	\N	26	3	\N	2026-05-08 11:53:58.547	\N	\N	\N	\N
46	SAMPLE Acme Computers A/c	\N	ASSET	DEBIT	\N	t	-2000.00	\N	26	1	\N	2026-05-08 11:53:58.124	\N	\N	\N	\N
2	Bank Account	1010	ASSET	DEBIT	Main business bank account	t	11000.00	\N	\N	\N	\N	2026-05-08 11:53:15.435	\N	\N	\N	\N
\.


--
-- Data for Name: AccountGroup; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."AccountGroup" (id, name, type, "parentId", "sortOrder", "isActive") FROM stdin;
1	Capital Account	LIABILITY	\N	10	t
2	Loans (Liability)	LIABILITY	\N	20	t
3	Current Liabilities	LIABILITY	\N	30	t
4	Fixed Assets	ASSET	\N	40	t
5	Investments	ASSET	\N	50	t
6	Current Assets	ASSET	\N	60	t
7	Branch / Divisions	ASSET	\N	70	t
8	Misc. Expenses (Asset)	ASSET	\N	80	t
9	Suspense A/c	ASSET	\N	90	t
10	Sales Accounts	INCOME	\N	100	t
11	Purchase Accounts	EXPENSE	\N	110	t
12	Direct Incomes	INCOME	\N	120	t
13	Direct Expenses	EXPENSE	\N	130	t
14	Indirect Incomes	INCOME	\N	140	t
15	Indirect Expenses	EXPENSE	\N	150	t
16	Reserves & Surplus	LIABILITY	1	10	t
17	Bank OD A/c	LIABILITY	2	10	t
18	Secured Loans	LIABILITY	2	20	t
19	Unsecured Loans	LIABILITY	2	30	t
20	Duties & Taxes	LIABILITY	3	10	t
21	Provisions	LIABILITY	3	20	t
22	Sundry Creditors	LIABILITY	3	30	t
23	Stock-in-Hand	ASSET	6	10	t
24	Deposits (Asset)	ASSET	6	20	t
25	Loans & Advances (Asset)	ASSET	6	30	t
26	Sundry Debtors	ASSET	6	40	t
27	Cash-in-Hand	ASSET	6	50	t
28	Bank Accounts	ASSET	6	60	t
\.


--
-- Data for Name: BookPeriod; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."BookPeriod" (id, "fromDate", "toDate", "isLocked", "lockedAt", "lockedById", reason, "createdAt", "updatedAt") FROM stdin;
1	2024-04-01	2025-03-31	t	2026-05-08 11:54:09.303	1	SAMPLE FY 2024-25 audited and closed	2026-05-08 11:54:09.305	2026-05-08 11:54:09.305
\.


--
-- Data for Name: Branch; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Branch" (id, name, address, phone, "isActive", "createdAt") FROM stdin;
\.


--
-- Data for Name: ChatMessage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ChatMessage" (id, "roomId", "senderUserId", "messageType", title, body, link, "createdAt") FROM stdin;
\.


--
-- Data for Name: ChatRoom; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ChatRoom" (id, key, type, name, "ownerUserId", "roleId", "isActive", "createdAt", "updatedAt") FROM stdin;
cmowuwnit000e04l50s6beb3w	system:1	SYSTEM_INBOX	System Inbox	1	\N	t	2026-05-08 11:53:35.765	2026-05-08 11:53:35.789
cmowuwnoz000f04l5e3wpr7w0	org:all	ORG_GROUP	Organisation Group	\N	\N	t	2026-05-08 11:53:35.987	2026-05-08 11:53:36.009
cmowuwnv8000g04l5px8l3con	role:R1	ROLE_GROUP	R1 Group	\N	R1	t	2026-05-08 11:53:36.212	2026-05-08 11:53:36.212
\.


--
-- Data for Name: ChatRoomMember; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ChatRoomMember" (id, "roomId", "userId", "joinedAt", "lastReadAt") FROM stdin;
1	cmowuwnit000e04l50s6beb3w	1	2026-05-08 11:53:36.656	\N
3	cmowuwnoz000f04l5e3wpr7w0	1	2026-05-08 11:53:37.871	\N
4	cmowuwnv8000g04l5px8l3con	1	2026-05-08 11:53:38.179	\N
\.


--
-- Data for Name: Company; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Company" (id, name, address, "companyReg", "taxId", "isActive", "createdAt", gstin, "gstStateCode", "gstRegType", "financialYearFrom", "booksBeginningFrom") FROM stdin;
1	SAMPLE Delta Distributors	\N	\N	\N	t	2026-05-08 11:53:58.669	\N	\N	\N	\N	\N
2	SAMPLE EastWest Hardware	\N	\N	\N	t	2026-05-08 11:53:58.902	\N	\N	\N	\N	\N
\.


--
-- Data for Name: CrmLead; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."CrmLead" (id, "pipelineId", status, title, "contactName", phone, email, "companyName", "valuePaise", source, notes, "personId", "companyId", "ownerUserId", "createdById", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Department; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Department" (id, name, description, "branchId", "createdAt") FROM stdin;
\.


--
-- Data for Name: Device; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Device" (id, type, brand, model, problem, "accountId") FROM stdin;
\.


--
-- Data for Name: Email; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Email" (id, email, "personId", "companyId", label, "isPrimary", "createdAt") FROM stdin;
\.


--
-- Data for Name: InvBrand; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvBrand" (id, name, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: InvCategory; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvCategory" (id, name, slug, "parentId", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: InvProduct; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvProduct" (id, sku, name, "unitId", "categoryId", "groupId", "brandId", "warrantyTermId", "modelNo", barcode1, barcode2, barcode3, ean1, ean2, ean3, upc1, upc2, upc3, notes, "isActive", "createdAt", "updatedAt", slug, "shopSubheading", "shopDescription", "shopCategory", "pricePaise", "mrpPaise", "shopBadge", "imageUrl", "galleryJson", "specsJson", stock, "lowStockThreshold", "isListedInShop", "costPaise", "openingStock", "openingRate", "openingValue", "openingStockDate", "hsnCode", "gstRate", taxability) FROM stdin;
1	LAPTOP_BUSINESS_14_FHD	Business Laptop — 14″ FHD · 16 GB · 512 GB NVMe	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:19.671	2026-05-08 11:53:19.671	laptop-business-14-fhd	Windows 11 Pro ready · metal chassis · all‑day battery	14″ anti‑glare panel, backlit keyboard, and dual heat pipes for quiet office use. Ideal for sales, education, and field staff. Brand‑neutral build; ask for your preferred OEM on volume orders.	Laptops	5299000	5999000	Popular	https://images.pexels.com/photos/1229861/pexels-photo-1229861.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/1229861/pexels-photo-1229861.jpeg?auto=compress&cs=tinysrgb&w=900", "https://images.pexels.com/photos/7514838/pexels-photo-7514838.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"OS": "Windows 11 Pro (downgrade rights on request)", "Memory": "16 GB DDR4 (1 slot free)", "Display": "14.0″ FHD IPS (1920×1080)", "Storage": "512 GB NVMe SSD", "Warranty": "1 year carry‑in (extendable)"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
2	DESKTOP_TOWER_I5_16G	Tower PC — Core i5 · 16 GB · 512 GB · Wi‑Fi	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:19.899	2026-05-08 11:53:19.899	desktop-tower-i5-16g	Office & billing · tool‑less service door	Compact ATX tower with room for a second drive and low‑profile GPU. Pre‑imaged or barebone as required. Suitable for front desk, accounts, and light CAD with optional graphics.	Desktops	3899000	4399000	Workhorse	https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900", "https://images.pexels.com/photos/3862139/pexels-photo-3862139.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"CPU": "Intel Core i5 (12th/13th gen class)", "RAM": "16 GB DDR4", "Ports": "8× USB, HDMI, DisplayPort, GbE", "Storage": "512 GB NVMe + 1× 3.5″ bay free", "Graphics": "Intel UHD (low‑profile GPU optional)"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
3	AIO_24_FHD_SSD	All‑in‑One — 24″ FHD · SSD · wireless KB/M	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:20.104	2026-05-08 11:53:20.104	aio-24-fhd-ssd	One cable desk · reception & clinic friendly	Slim 24″ AIO with VESA option and pop‑up privacy webcam. Single power lead keeps counters tidy. Well suited for reception, small clinics, and estate offices.	Desktops	4599000	5099000	New	https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/256264/pexels-photo-256264.jpeg?auto=compress&cs=tinysrgb&w=900", "https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"CPU": "Latest gen U‑series", "Mount": "VESA 100 optional stand", "Display": "23.8″ FHD touch (non‑touch option)", "Storage": "512 GB NVMe", "Includes": "Wireless keyboard & mouse"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
4	MFP_INKJET_A4_WIFI	Colour inkjet MFP — A4 · Wi‑Fi · scan & copy	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:20.301	2026-05-08 11:53:20.301	mfp-inkjet-a4-wifi	Home office & SOHO · separate ink tanks	Print, scan, and copy in A4 with mobile print (iOS/Android) and borderless photo up to 4R. High‑yield tank refills available — ask for your city’s per‑page plan.	Printers	1899000	2199000	Bestseller	https://images.pexels.com/photos/1714208/pexels-photo-1714208.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/1714208/pexels-photo-1714208.jpeg?auto=compress&cs=tinysrgb&w=900", "https://images.pexels.com/photos/1714341/pexels-photo-1714341.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"Duty": "Up to 1 500 pages / month (rec.)", "Speed": "Up to 15 ppm mono (ISO)", "Functions": "Print / scan / copy", "Max paper": "A4 / legal", "Connectivity": "USB, Wi‑Fi, direct mobile"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
5	LASER_MONO_DUPLEX_WIFI	Mono laser — duplex · GbE · Wi‑Fi	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:20.489	2026-05-08 11:53:20.489	laser-mono-duplex-wifi	High‑volume text · TCO friendly	Automatic duplex, 250‑sheet tray, and optional second tray for branch offices. Toner save mode and secure print queue for shared workgroups.	Printers	2249000	2599000	Office	https://images.pexels.com/photos/1714341/pexels-photo-1714341.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/1714341/pexels-photo-1714341.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"Tray": "250 sheets + multipurpose", "Speed": "Up to 40 ppm", "Duplex": "Auto A4", "Network": "Ethernet + dual‑band Wi‑Fi", "Monthly duty": "Up to 80 000 pages"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
6	IP_BULLET_CAMERA_5MP_POE	IP bullet camera — 5 MP · PoE · IR 40 m	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:20.699	2026-05-08 11:53:20.699	ip-bullet-camera-5mp-poe	Outdoor metal housing · ONVIF profile S	Fixed lens bullet with smart IR and corridor mode for aisles. Powered via PoE switch or injector — ideal for retail fronts, godowns, and lane coverage.	CCTV & Security	749900	899900	PoE	https://images.pexels.com/photos/8463140/pexels-photo-8463140.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/8463140/pexels-photo-8463140.jpeg?auto=compress&cs=tinysrgb&w=900", "https://images.pexels.com/photos/2582937/pexels-photo-2582937.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"Lens": "2.8 mm (wide) fixed", "Night": "IR up to 40 m", "Power": "DC12 V / PoE 802.3af", "Sensor": "5 MP 1/2.7″", "Protocol": "ONVIF, RTSP, mobile app"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
7	NVR_8CH_4K_POE	NVR — 8 channels · 4K decode · 4 PoE ports	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:20.911	2026-05-08 11:53:20.911	nvr-8ch-4k-poe	Small shop kit · HDMI · dual SATA	Plug‑and‑play PoE ports for cameras, HDMI spot monitor output, and dual HDD bays for redundancy (RAID optional on firmware). Includes mouse and quick‑start guide.	CCTV & Security	1499900	1749900	Kit ready	https://images.pexels.com/photos/4302071/pexels-photo-4302071.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/4302071/pexels-photo-4302071.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"PoE": "4 × 802.3af built‑in", "Display": "HDMI + VGA", "Storage": "2 × SATA (up to 8 TB each)", "Channels": "8 IP (up to 8 MP each)", "Bandwidth": "80 Mbps incoming"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
8	DDR5_SODIMM_16GB_5600	DDR5 SODIMM — 16 GB · 5600 MT/s · laptop	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:21.133	2026-05-08 11:53:21.133	ddr5-sodimm-16gb-5600	Single rank · major brand sealed pack	Drop‑in upgrade for compatible business laptops. XMP not required — JEDEC profile for stability. Bulk pricing available for fleet refreshes.	Components	349900	429900	\N	https://images.pexels.com/photos/777001/pexels-photo-777001.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/777001/pexels-photo-777001.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"Form": "262‑pin SODIMM", "Speed": "PC5‑44800 (5600 MT/s)", "Voltage": "1.1 V DDR5", "Capacity": "16 GB", "Compatibility": "DDR5 laptops only"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
9	NVME_SSD_1TB_GEN4	NVMe SSD — 1 TB · PCIe 4.0 ×4	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:21.355	2026-05-08 11:53:21.355	nvme-ssd-1tb-gen4	TLC · DRAM cache · 5‑year warranty class	Upgrade path for desktops and laptops with M.2 slot. Sequential reads suited to OS + apps + light video. Cloning service available at our service centre.	Components	729900	849900	Fast ship	https://images.pexels.com/photos/1181677/pexels-photo-1181677.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/1181677/pexels-photo-1181677.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"TBW": "600 TB (typical 1 TB)", "Form": "M.2 2280", "NAND": "3D TLC", "Interface": "PCIe Gen4 ×4 NVMe 1.4", "Seq. read": "Up to 7000 MB/s class"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
10	PSU_GOLD_650W_MODULAR	PSU — 650 W · 80+ Gold · semi‑modular	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:21.564	2026-05-08 11:53:21.564	psu-gold-650w-modular	ATX · 120 mm fan · overload & OTP	Reliable replacement or new build supply with flat cables for airflow. Suitable for mid‑tower workstations with discrete GPU up to class‑appropriate draw.	Components	629900	749900	\N	https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/3861969/pexels-photo-3861969.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"Rails": "+12 V single rail", "Output": "650 W continuous", "Warranty": "5 years (brand‑dependent)", "Connectors": "24‑pin, EPS, PCIe, SATA", "Efficiency": "80 PLUS Gold"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
11	MONITOR_24_FHD_IPS_75HZ	LED monitor — 24″ FHD IPS · 75 Hz	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:21.767	2026-05-08 11:53:21.767	monitor-24-fhd-ips-75hz	Thin bezel · HDMI & VGA · VESA	Flicker‑safe panel for long billing and BPO shifts. 75 Hz smoothness for everyday UI. Tilt stand; VESA mount for arms and wall brackets.	Monitors	999900	1149900	Desk staple	https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/1181244/pexels-photo-1181244.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"VESA": "100 × 100 mm", "Panel": "23.8″ IPS FHD", "Ports": "HDMI 1.4, VGA, audio out", "Refresh": "75 Hz", "Brightness": "250 nits (typ.)"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
12	USB_WIFI6_ADAPTER_AX1800	USB Wi‑Fi 6 adapter — AX1800	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:22.016	2026-05-08 11:53:22.016	usb-wifi6-adapter-ax1800	Upgrade older desktops to Wi‑Fi 6	Compact dongle with external antenna option for weak coverage areas. WPA3 support and driver pack for current Windows releases.	Networking	189900	229900	\N	https://images.pexels.com/photos/159304/network-cable-ethernet-computer-159304.jpeg?auto=compress&cs=tinysrgb&w=900	["https://images.pexels.com/photos/159304/network-cable-ethernet-computer-159304.jpeg?auto=compress&cs=tinysrgb&w=900"]	{"OS": "Windows 10/11 (driver)", "Bands": "Dual band 2.4 + 5 GHz", "Speed": "AX1800 class", "Standard": "Wi‑Fi 6 (802.11ax)", "Interface": "USB 3.2 Gen1"}	\N	5	t	\N	\N	\N	\N	\N	\N	\N	\N
13	SAMPLE-MOU-01	SAMPLE Wireless Mouse	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:59.151	2026-05-08 11:53:59.151	\N	\N	\N	\N	\N	80000	\N	\N	\N	\N	0	5	f	30000	\N	\N	\N	\N	\N	\N	\N
14	SAMPLE-KEY-01	SAMPLE Mechanical Keyboard	1	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	t	2026-05-08 11:53:59.15	2026-05-08 11:54:00.957	\N	\N	\N	\N	\N	150000	\N	\N	\N	\N	50	5	f	80000	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: InvProductGroup; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvProductGroup" (id, name, "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: InvStockLedger; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvStockLedger" (id, "productId", "voucherId", date, "inQty", "outQty", rate, amount) FROM stdin;
1	14	1	2026-03-23	50.000	0.000	800.00	40000.00
\.


--
-- Data for Name: InvUnit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvUnit" (id, code, label, decimals, "isActive", "createdAt", "updatedAt") FROM stdin;
1	PCS	Piece	0	t	2026-05-08 11:53:19.254	2026-05-08 11:53:19.254
\.


--
-- Data for Name: InvWarrantyTerm; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."InvWarrantyTerm" (id, name, description, "durationMonths", "isActive", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Permission; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Permission" (id, label, description, module) FROM stdin;
admin:bypass	Bypass all permission checks	Grants full access to everything. Skips every permission check in the system.	core
customers:view	View customers & companies	Access the Customers and Companies pages and view records.	customers
customers:manage	Manage customers	Create, edit, and delete customer records.	customers
companies:manage	Manage companies	Create, edit, and delete company records.	customers
customers:view:own	View own customers	View customer records owned by the user.	customers
customers:view:department	View department customers	View customer records within user departments.	customers
customers:view:branch	View branch customers	View customer records within user branches.	customers
customers:view:org	View organisation customers	View customer records across the organisation.	customers
customers:create	Create customers	Create customer records.	customers
customers:edit:own	Edit own customers	Edit customer records owned by the user.	customers
customers:edit:department	Edit department customers	Edit customer records within user departments.	customers
customers:edit:branch	Edit branch customers	Edit customer records within user branches.	customers
customers:edit:org	Edit organisation customers	Edit customer records across the organisation.	customers
customers:delete:own	Delete own customers	Delete customer records owned by the user.	customers
customers:delete:department	Delete department customers	Delete customer records within user departments.	customers
customers:delete:branch	Delete branch customers	Delete customer records within user branches.	customers
customers:delete:org	Delete organisation customers	Delete customer records across the organisation.	customers
companies:create	Create companies	Create company records.	customers
companies:edit:org	Edit companies	Edit company records.	customers
companies:delete:org	Delete companies	Delete company records.	customers
tickets:create	Create tickets	Open and submit new tickets.	tickets
tickets:status:set	Set ticket status	Move a ticket between pipeline statuses.	tickets
tickets:substatus:set	Set ticket sub-status	Set the sub-status on a ticket.	tickets
tickets:assign	Assign tickets	Claim, pass, or reject primary ownership of a ticket.	tickets
tickets:manage-participants	Manage ticket participants	Add or remove secondary owners on a ticket.	tickets
warranty:convert	Edit warranty status	Change the warranty field on a ticket (in-warranty / out-of-warranty).	tickets
tickets:view:own	View own tickets	View tickets owned by the user.	tickets
tickets:view:department	View department tickets	View tickets within user departments.	tickets
tickets:view:branch	View branch tickets	View tickets within user branches.	tickets
tickets:view:org	View organisation tickets	View tickets across the organisation.	tickets
tickets:edit:own	Edit own tickets	Edit tickets owned by the user.	tickets
tickets:edit:department	Edit department tickets	Edit tickets in user departments.	tickets
tickets:edit:branch	Edit branch tickets	Edit tickets in user branches.	tickets
tickets:edit:org	Edit organisation tickets	Edit tickets across the organisation.	tickets
tickets:delete:own	Delete own tickets	Delete tickets owned by the user.	tickets
tickets:delete:department	Delete department tickets	Delete tickets in user departments.	tickets
tickets:delete:branch	Delete branch tickets	Delete tickets in user branches.	tickets
tickets:delete:org	Delete organisation tickets	Delete tickets across the organisation.	tickets
assignments:view-team	View team assignments	See the My Team tab — all tickets routed to your role.	assignments
assignments:view-org	View organisation assignments	See the All Organisation tab — every active ticket across all roles.	assignments
assignments:view:own	View own assignments	View assignments directly owned by the user.	assignments
assignments:view:department	View department assignments	View assignments inside user departments.	assignments
assignments:view:branch	View branch assignments	View assignments inside user branches.	assignments
assignments:view:org	View organisation assignments	View assignments across the organisation.	assignments
service-centers:view	View service centers	Access the Service Centers page in the sidebar.	service
service-centers:manage	Manage service centers	Add, edit, and delete service center records.	service
service-centers:view:branch	View branch service centers	View service centers in user branches.	service
service-centers:view:org	View organisation service centers	View service centers across the organisation.	service
service-centers:create	Create service centers	Create service center records.	service
service-centers:edit:org	Edit service centers	Edit service center records.	service
service-centers:delete:org	Delete service centers	Delete service center records.	service
users:manage	Manage users	Create, edit, and delete user accounts.	admin
roles:manage	Manage roles	Create and edit roles and their permission sets.	admin
settings:manage	Manage org settings	Manage branches, departments, and posts.	admin
settings:statuses	Manage statuses & sub-statuses	Create, edit, and delete ticket statuses and sub-statuses.	admin
settings:pipelines	Manage pipelines	Create, edit, and configure pipelines.	admin
users:create	Create users	Create user accounts.	admin
users:edit:org	Edit users	Edit user accounts.	admin
users:delete:org	Delete users	Delete user accounts.	admin
roles:create	Create roles	Create role definitions.	admin
roles:edit:org	Edit roles	Edit role definitions and grants.	admin
roles:delete:org	Delete roles	Delete custom role definitions.	admin
settings:edit	Edit settings	Edit organisation-wide settings.	admin
settings:statuses:create	Create statuses	Create ticket statuses and sub-statuses.	admin
settings:statuses:edit	Edit statuses	Edit ticket statuses and sub-statuses.	admin
settings:statuses:delete	Delete statuses	Delete ticket statuses and sub-statuses.	admin
settings:pipelines:create	Create pipelines	Create pipelines.	admin
settings:pipelines:edit	Edit pipelines	Edit pipelines.	admin
settings:pipelines:delete	Delete pipelines	Delete pipelines.	admin
ecommerce:manage	Manage ecommerce catalog & orders	Create shop products and view customer orders.	admin
inventory:manage	Manage inventory masters	Maintain units, categories, brands, warranty terms, and inventory product masters.	admin
crm:view	View CRM leads	View the CRM leads list and lead details.	crm
crm:manage	Manage CRM leads	Create, edit, delete, and reassign CRM leads.	crm
finance:journal:cancel	Cancel journal entries	Mark a POSTED journal entry as CANCELLED. The original keeps its reference number and stays visible in lists; a reversing entry is written for the audit trail.	finance
finance:journal:delete	Delete journal entries	Soft-delete: hide a journal entry from normal views and exclude it from balance calculations. Recoverable via restore.	finance
finance:journal:hard-delete	Hard-delete journal entries	Physically remove a journal entry. A snapshot is written to the audit log so the deletion itself is traceable. Use for cleanup only.	finance
finance:invoice:cancel	Cancel invoices	Reverse posted invoice JE and mark VOID. Reference number preserved.	finance
finance:invoice:delete	Delete invoices	Soft-delete invoice; reverses GL impact if posted. Recoverable via restore.	finance
finance:invoice:hard-delete	Hard-delete invoices	Physically remove an invoice. A snapshot is written to the audit log.	finance
finance:payment:cancel	Cancel payments	Reverse a posted payment and mark CANCELLED.	finance
finance:payment:delete	Delete payments	Soft-delete a payment; reverses GL impact. Recoverable via restore.	finance
finance:payment:hard-delete	Hard-delete payments	Physically remove a payment. A snapshot is written to the audit log.	finance
finance:voucher:create	Create vouchers	Create Contra / Payment / Receipt / Credit Note / Debit Note vouchers.	finance
finance:voucher:post	Post vouchers	Move a draft voucher to POSTED — applies GL impact.	finance
finance:voucher:cancel	Cancel vouchers	Reverse a posted voucher and mark CANCELLED.	finance
finance:voucher:delete	Delete vouchers	Soft-delete a voucher; reverses GL impact. Recoverable.	finance
finance:voucher:hard-delete	Hard-delete vouchers	Physically remove a voucher with audit snapshot.	finance
finance:voucher:edit-draft	Edit draft vouchers	Edit DRAFT vouchers (no GL impact yet) — granted with finance:voucher:create.	finance
finance:voucher:edit-posted	Edit posted vouchers	Tally-style edit-after-posting: atomic reverse + reapply with audit log. Granted to supervisors / managers.	finance
finance:voucher:edit-locked	Edit in locked period	Override BookPeriod lock. Admin only — every override is audit-logged.	finance
finance:invoice:edit-draft	Edit draft invoices	Edit DRAFT invoices (no GL impact yet). Granted with finance:voucher:create.	finance
finance:invoice:edit-posted	Edit posted invoices	Tally-style edit-after-posting for invoices. Refused once any payment exists — reverse payment first.	finance
finance:book-period:manage	Lock / unlock book periods	Open or close accounting periods (year-end / audit close).	finance
finance:allocation:manage	Manage bill-wise allocations	Link / unlink any voucher to any other voucher (full or partial), drives outstandings + aging.	finance
finance:opening-balance:manage	Manage opening balances	Edit per-account opening balance and opening stock at the books-beginning date.	finance
inventory:voucher:cancel	Cancel inventory vouchers	Reverse stock + GL impact and mark CANCELLED.	inventory
inventory:voucher:delete	Delete inventory vouchers	Soft-delete; reverses stock + GL impact. Recoverable via restore.	inventory
inventory:voucher:hard-delete	Hard-delete inventory vouchers	Physically remove with audit snapshot.	inventory
inventory:voucher:edit-draft	Edit draft inventory vouchers	Edit DRAFT InvVouchers (no stock/GL impact yet). Granted with finance:voucher:create.	inventory
inventory:voucher:edit-posted	Edit posted inventory vouchers	Tally-style edit-after-posting for InvVouchers — reverses stock + GL atomically. Refused for POS-originated vouchers (edit the linked Invoice instead).	inventory
accountancy:create:own	Create accountancy entries (own)	Create vouchers / invoices / journal entries within own scope.	accountancy
accountancy:view:own	View accountancy (own)	View accountancy data scoped to own records.	accountancy
accountancy:view:br	View accountancy (branch)	View accountancy data across the user's branch.	accountancy
accountancy:view:org	View accountancy (organisation)	View the full accountancy module across the organisation. This is the gate that shows / hides the Accountancy sidebar section.	accountancy
accountancy:edit:own	Edit accountancy (own)	Edit accountancy entries within own scope.	accountancy
accountancy:edit:br	Edit accountancy (branch)	Edit accountancy entries across the user's branch.	accountancy
accountancy:edit:org	Edit accountancy (organisation)	Edit any accountancy entry organisation-wide.	accountancy
accountancy:delete:own	Delete accountancy (own)	Delete own accountancy entries (subject to per-operation guards).	accountancy
accountancy:delete:br	Delete accountancy (branch)	Delete branch-scoped accountancy entries.	accountancy
accountancy:delete:org	Delete accountancy (organisation)	Delete any accountancy entry organisation-wide.	accountancy
\.


--
-- Data for Name: Person; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Person" (id, name, address, "agreedToTerms", "agreedAt", "isActive", "createdAt", gstin, "gstStateCode", "gstRegType") FROM stdin;
1	SAMPLE Acme Computers	\N	f	\N	t	2026-05-08 11:53:57.995	\N	\N	\N
2	SAMPLE Bharat IT Solutions	\N	f	\N	t	2026-05-08 11:53:58.226	\N	\N	\N
3	SAMPLE Coastal Systems	\N	f	\N	t	2026-05-08 11:53:58.445	\N	\N	\N
\.


--
-- Data for Name: PersonCompany; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."PersonCompany" (id, "personId", "companyId", role, "linkedAt", "unlinkedAt") FROM stdin;
\.


--
-- Data for Name: PersonPortalCredential; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."PersonPortalCredential" (id, "personId", "phoneNormalized", "emailNormalized", "passwordHash", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Phone; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Phone" (id, phone, "personId", "companyId", label, "isPrimary", "createdAt") FROM stdin;
\.


--
-- Data for Name: Pipeline; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Pipeline" (id, name, label, description, color, "isDefault", "isActive", "order", "createdAt") FROM stdin;
P1	service	Service & Repair	Electronics repair and service workflow	bg-blue-100 text-blue-600	t	t	0	2026-05-08 11:52:43.09
P2	customer-support	Customer Support	General customer support tickets not related to repairs	bg-teal-100 text-teal-700	f	t	2	2026-05-08 11:52:44.146
P3	sales	Sales	Sales pipeline for new customers and upsell opportunities	bg-green-100 text-green-700	f	t	3	2026-05-08 11:52:45.004
P4	internal-management	Internal Management	Internal tasks, HR, admin, and operational workflows	bg-purple-100 text-purple-700	f	t	4	2026-05-08 11:52:45.84
P5	marketing	Marketing	Marketing campaigns, content, and outreach initiatives	bg-pink-100 text-pink-700	f	t	5	2026-05-08 11:52:46.44
P7	sales-orders	Sales Orders	Order processing pipeline — online, in-store, phone, and WhatsApp orders	bg-amber-100 text-amber-800	f	t	7	2026-05-08 11:52:47.13
P6	crm-leads	CRM Leads	Sales-style leads without repair tickets; stages shared with pipeline settings	bg-cyan-100 text-cyan-800	f	t	6	2026-05-08 11:52:48.042
\.


--
-- Data for Name: Post; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Post" (id, title, "branchId", "departmentId", "parentPostId", "roleTemplateId", "createdAt") FROM stdin;
\.


--
-- Data for Name: Role; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Role" (id, label, color, rank, "isSystem") FROM stdin;
R1	Admin	bg-red-100 text-red-600	0	t
R2	Technician	bg-blue-100 text-blue-600	0	t
R3	Front Desk	bg-green-100 text-green-600	0	t
R4	Despatch	bg-purple-100 text-purple-600	0	t
\.


--
-- Data for Name: RolePermission; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."RolePermission" ("roleId", "permissionId") FROM stdin;
R1	admin:bypass
R1	customers:view
R1	customers:manage
R1	companies:manage
R1	customers:view:own
R1	customers:view:department
R1	customers:view:branch
R1	customers:view:org
R1	customers:create
R1	customers:edit:own
R1	customers:edit:department
R1	customers:edit:branch
R1	customers:edit:org
R1	customers:delete:own
R1	customers:delete:department
R1	customers:delete:branch
R1	customers:delete:org
R1	companies:create
R1	companies:edit:org
R1	companies:delete:org
R1	tickets:create
R1	tickets:status:set
R1	tickets:substatus:set
R1	tickets:assign
R1	tickets:manage-participants
R1	warranty:convert
R1	tickets:view:own
R1	tickets:view:department
R1	tickets:view:branch
R1	tickets:view:org
R1	tickets:edit:own
R1	tickets:edit:department
R1	tickets:edit:branch
R1	tickets:edit:org
R1	tickets:delete:own
R1	tickets:delete:department
R1	tickets:delete:branch
R1	tickets:delete:org
R1	assignments:view-team
R1	assignments:view-org
R1	assignments:view:own
R1	assignments:view:department
R1	assignments:view:branch
R1	assignments:view:org
R1	service-centers:view
R1	service-centers:manage
R1	service-centers:view:branch
R1	service-centers:view:org
R1	service-centers:create
R1	service-centers:edit:org
R1	service-centers:delete:org
R1	users:manage
R1	roles:manage
R1	settings:manage
R1	settings:statuses
R1	settings:pipelines
R1	users:create
R1	users:edit:org
R1	users:delete:org
R1	roles:create
R1	roles:edit:org
R1	roles:delete:org
R1	settings:edit
R1	settings:statuses:create
R1	settings:statuses:edit
R1	settings:statuses:delete
R1	settings:pipelines:create
R1	settings:pipelines:edit
R1	settings:pipelines:delete
R1	ecommerce:manage
R1	inventory:manage
R1	crm:view
R1	crm:manage
R1	finance:journal:cancel
R1	finance:journal:delete
R1	finance:journal:hard-delete
R1	finance:invoice:cancel
R1	finance:invoice:delete
R1	finance:invoice:hard-delete
R1	finance:payment:cancel
R1	finance:payment:delete
R1	finance:payment:hard-delete
R1	finance:voucher:create
R1	finance:voucher:post
R1	finance:voucher:cancel
R1	finance:voucher:delete
R1	finance:voucher:hard-delete
R1	finance:voucher:edit-draft
R1	finance:voucher:edit-posted
R1	finance:voucher:edit-locked
R1	finance:invoice:edit-draft
R1	finance:invoice:edit-posted
R1	finance:book-period:manage
R1	finance:allocation:manage
R1	finance:opening-balance:manage
R1	inventory:voucher:cancel
R1	inventory:voucher:delete
R1	inventory:voucher:hard-delete
R1	inventory:voucher:edit-draft
R1	inventory:voucher:edit-posted
R1	accountancy:create:own
R1	accountancy:view:own
R1	accountancy:view:br
R1	accountancy:view:org
R1	accountancy:edit:own
R1	accountancy:edit:br
R1	accountancy:edit:org
R1	accountancy:delete:own
R1	accountancy:delete:br
R1	accountancy:delete:org
R2	customers:view
R2	tickets:create
R2	tickets:status:set
R2	tickets:substatus:set
R2	tickets:assign
R2	tickets:manage-participants
R2	warranty:convert
R2	assignments:view-team
R2	service-centers:view
R3	customers:view
R3	customers:manage
R3	companies:manage
R3	tickets:create
R3	tickets:status:set
R3	tickets:substatus:set
R3	tickets:assign
R3	assignments:view-team
R3	crm:view
R3	crm:manage
R4	customers:view
R4	tickets:substatus:set
R4	tickets:assign
R4	assignments:view-team
\.


--
-- Data for Name: ServiceCenter; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ServiceCenter" (id, name, phone, email, address, "createdAt") FROM stdin;
\.


--
-- Data for Name: ShopCoupon; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ShopCoupon" (id, code, "percentOff", "flatPaise", "isActive", "expiresAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ShopOrder; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ShopOrder" (id, status, "orderSource", "pipelineId", "statusId", "accountId", "personId", "guestEmail", "guestPhone", "shippingName", "shippingAddress", "totalPaise", "razorpayOrderId", "razorpayPaymentId", courier, "trackingNumber", "sourceCouponId", "paidAt", "packedAt", "shippedAt", "deliveredAt", "refundedAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ShopOrderLine; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."ShopOrderLine" (id, "orderId", "productId", quantity, "unitPricePaise") FROM stdin;
\.


--
-- Data for Name: StatusTransition; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."StatusTransition" (id, "fromStatusId", "toStatusId") FROM stdin;
1	S1	S2
2	S1	S9
3	S2	S3
4	S2	S4
5	S2	S8
6	S2	S9
7	S3	S4
8	S3	S6
9	S3	S8
10	S4	S5
11	S5	S3
12	S5	S6
13	S6	S7
14	S7	S1
15	S8	S1
16	S42	S43
17	S42	S48
18	S43	S44
19	S43	S48
20	S44	S45
21	S44	S48
22	S45	S46
23	S46	S47
24	S46	S49
\.


--
-- Data for Name: SubStatusGroup; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."SubStatusGroup" (id, label, "order") FROM stdin;
customer_comm	Call	1
approval	Quote	2
parts	Parts	3
qc	QC	4
escalated	Escalated	5
ready	Ready	6
no_fix	No Fix	7
\.


--
-- Data for Name: SubStatusTransition; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."SubStatusTransition" (id, "fromSubStatusId", "toSubStatusId") FROM stdin;
1	\N	SS1
2	\N	SS2
3	SS1	SS3
4	SS1	SS4
5	SS2	SS3
6	SS2	SS4
7	SS3	SS4
8	\N	SS5
9	SS5	SS6
10	SS6	SS7
11	SS6	SS8
12	SS6	SS9
13	SS7	SS8
14	SS7	SS9
15	\N	SS10
16	SS10	SS11
17	SS10	SS12
18	SS10	SS13
19	SS11	SS12
20	SS11	SS13
21	SS12	SS13
22	\N	SS14
23	SS14	SS15
24	SS14	SS16
25	SS14	SS17
26	SS16	SS14
27	SS17	SS15
28	SS17	SS16
29	\N	SS18
30	SS18	SS19
31	SS19	SS20
32	SS20	SS21
33	\N	SS22
34	SS22	SS23
35	SS23	SS24
36	SS24	SS25
37	SS25	SS26
38	SS25	SS27
39	SS26	SS27
40	SS27	SS28
41	\N	SS29
42	SS29	SS30
43	SS30	SS31
44	\N	SS32
45	SS32	SS33
46	SS33	SS34
47	SS33	SS35
\.


--
-- Data for Name: Ticket; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Ticket" (id, "sourceShopOrderId", "pipelineId", status, priority, notes, "accessInfo", "estimatedCost", "deviceId", escalated, "escalatedAt", "escalationType", "expectedReturn", "receivedBackAt", "externalRef", "serviceCenterId", "subStatusId", "isWarranty", "warrantyStatus", "warrantyRef", "purchaseDate", "voidReason", "primaryOwnerId", "billingAccountId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: TicketLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."TicketLog" (id, "ticketId", status, note, "userId", "subStatusId", visibility, "createdAt") FROM stdin;
\.


--
-- Data for Name: TicketParticipant; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."TicketParticipant" (id, "ticketId", "userId", "addedById", "addedForRole", "addedBySubStatusId", "removedAt", "removedBySubStatusId", "createdAt") FROM stdin;
\.


--
-- Data for Name: TicketStatus; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."TicketStatus" (id, label, color, "order", "isTerminal", "isEntryPoint", "allowedRoles", "notifyRoles", "actionLabel", "warrantyScope", "pipelineId") FROM stdin;
S1	Received	bg-gray-100 text-gray-600	1	f	t	{}	{}	\N	any	P1
S2	Diagnosing	bg-yellow-100 text-yellow-700	2	f	f	{}	{}	\N	any	P1
S3	Repairing	bg-blue-100 text-blue-700	3	f	f	{}	{}	\N	any	P1
S4	Escalated	bg-orange-100 text-orange-700	4	f	f	{}	{}	\N	any	P1
S5	Received Back	bg-purple-100 text-purple-700	5	f	f	{}	{}	\N	any	P1
S6	Ready	bg-green-100 text-green-700	6	f	f	{}	{}	\N	any	P1
S7	Returned	bg-gray-200 text-gray-500	7	t	f	{}	{}	\N	any	P1
S8	Closed - No Fix	bg-red-100 text-red-600	8	t	f	{}	{}	\N	any	P1
S9	Cancelled	bg-gray-100 text-gray-400	9	t	f	{}	{}	\N	any	P1
S10	New Request	bg-gray-100 text-gray-600	1	f	t	{}	{}	\N	any	P2
S11	In Triage	bg-yellow-100 text-yellow-700	2	f	f	{}	{}	\N	any	P2
S12	Assigned	bg-blue-100 text-blue-600	3	f	f	{}	{}	\N	any	P2
S13	In Progress	bg-indigo-100 text-indigo-600	4	f	f	{}	{}	\N	any	P2
S14	Pending Customer	bg-orange-100 text-orange-600	5	f	f	{}	{}	\N	any	P2
S15	Resolved	bg-green-100 text-green-600	6	f	f	{}	{}	\N	any	P2
S16	Closed	bg-gray-100 text-gray-400	7	t	f	{}	{}	\N	any	P2
S17	Lead	bg-gray-100 text-gray-600	1	f	t	{}	{}	\N	any	P3
S18	Contacted	bg-blue-100 text-blue-600	2	f	f	{}	{}	\N	any	P3
S19	Qualified	bg-teal-100 text-teal-600	3	f	f	{}	{}	\N	any	P3
S20	Proposal Sent	bg-yellow-100 text-yellow-700	4	f	f	{}	{}	\N	any	P3
S21	Negotiation	bg-orange-100 text-orange-600	5	f	f	{}	{}	\N	any	P3
S22	Won	bg-green-100 text-green-700	6	t	f	{}	{}	\N	any	P3
S23	Lost	bg-red-100 text-red-600	7	t	f	{}	{}	\N	any	P3
S24	Open	bg-gray-100 text-gray-600	1	f	t	{}	{}	\N	any	P4
S25	In Review	bg-yellow-100 text-yellow-700	2	f	f	{}	{}	\N	any	P4
S26	In Progress	bg-blue-100 text-blue-600	3	f	f	{}	{}	\N	any	P4
S27	On Hold	bg-orange-100 text-orange-600	4	f	f	{}	{}	\N	any	P4
S28	Done	bg-green-100 text-green-600	5	t	f	{}	{}	\N	any	P4
S29	Idea	bg-gray-100 text-gray-600	1	f	t	{}	{}	\N	any	P5
S30	Planning	bg-yellow-100 text-yellow-700	2	f	f	{}	{}	\N	any	P5
S31	In Execution	bg-blue-100 text-blue-600	3	f	f	{}	{}	\N	any	P5
S32	Under Review	bg-orange-100 text-orange-600	4	f	f	{}	{}	\N	any	P5
S33	Live	bg-teal-100 text-teal-600	5	f	f	{}	{}	\N	any	P5
S34	Completed	bg-green-100 text-green-600	6	t	f	{}	{}	\N	any	P5
S42	New	bg-gray-100 text-gray-600	1	f	t	{}	{}	\N	any	P7
S43	Under Review	bg-yellow-100 text-yellow-700	2	f	f	{}	{}	Mark Under Review	any	P7
S44	Confirmed	bg-blue-100 text-blue-700	3	f	f	{}	{}	Confirm Order	any	P7
S45	Packing	bg-indigo-100 text-indigo-700	4	f	f	{}	{}	Start Packing	any	P7
S46	Dispatched	bg-purple-100 text-purple-700	5	f	f	{}	{}	Mark Dispatched	any	P7
S47	Delivered	bg-green-100 text-green-700	6	t	f	{}	{}	Mark Delivered	any	P7
S48	Cancelled	bg-gray-100 text-gray-400	7	t	f	{}	{}	Cancel Order	any	P7
S49	Returned	bg-red-100 text-red-600	8	t	f	{}	{}	Mark Returned	any	P7
S35	Lead	bg-gray-100 text-gray-600	1	f	t	{}	{}	\N	any	P6
S36	Contacted	bg-blue-100 text-blue-600	2	f	f	{}	{}	\N	any	P6
S37	Qualified	bg-teal-100 text-teal-600	3	f	f	{}	{}	\N	any	P6
S38	Proposal Sent	bg-yellow-100 text-yellow-700	4	f	f	{}	{}	\N	any	P6
S39	Negotiation	bg-orange-100 text-orange-600	5	f	f	{}	{}	\N	any	P6
S40	Won	bg-green-100 text-green-700	6	t	f	{}	{}	\N	any	P6
S41	Lost	bg-red-100 text-red-600	7	t	f	{}	{}	\N	any	P6
\.


--
-- Data for Name: TicketSubStatus; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."TicketSubStatus" (id, label, color, "group", "order", "applicableStatusIds", "allowedRoles", "notifyRoles", "triggerMap", "actionLabel", "autoRevertOnClear", "handoffRole", "warrantyScope", "groupId", "pipelineId") FROM stdin;
SS1	Waiting: Customer Info	bg-yellow-50 text-yellow-700	customer_comm	1	{S2,S3,S6}	{R1,R2}	{R3}	{}	\N	t	\N	any	customer_comm	P1
SS2	Waiting: Customer to Bring Item	bg-yellow-50 text-yellow-700	customer_comm	2	{S2,S3}	{R1,R2}	{R3}	{}	\N	t	\N	any	customer_comm	P1
SS3	Customer Unreachable	bg-red-50 text-red-600	customer_comm	3	{S2,S3,S6}	{R1,R3}	{R1}	{}	\N	t	\N	any	customer_comm	P1
SS4	Customer Responded	bg-green-50 text-green-700	customer_comm	4	{S2,S3,S6}	{R1,R3}	{R2}	{}	\N	t	\N	any	customer_comm	P1
SS5	Quote Prepared	bg-blue-50 text-blue-600	approval	5	{S2}	{R1,R2}	{R3}	{}	\N	t	\N	any	approval	P1
SS6	Awaiting Customer Approval	bg-yellow-50 text-yellow-700	approval	6	{S2}	{R1,R3}	{}	{}	\N	t	\N	any	approval	P1
SS7	Awaiting Insurance / Warranty	bg-purple-50 text-purple-600	approval	7	{S2}	{R1,R3}	{R1}	{}	\N	t	\N	any	approval	P1
SS8	Customer Approved	bg-green-50 text-green-700	approval	8	{S2}	{R1,R3}	{R2}	{"S2": "S3"}	\N	t	\N	any	approval	P1
SS9	Customer Declined	bg-red-50 text-red-600	approval	9	{S2}	{R1,R3}	{R2}	{"S2": "S8"}	\N	t	\N	any	approval	P1
SS10	Awaiting Parts	bg-orange-50 text-orange-600	parts	10	{S3}	{R1,R2}	{R1}	{}	\N	t	\N	any	parts	P1
SS11	Parts Delayed	bg-orange-50 text-orange-600	parts	11	{S3}	{R1}	{R2,R3}	{}	\N	t	\N	any	parts	P1
SS12	Parts Issue	bg-red-50 text-red-600	parts	12	{S3}	{R1}	{R2,R3}	{}	\N	t	\N	any	parts	P1
SS13	Parts Arrived	bg-green-50 text-green-700	parts	13	{S3}	{R1}	{R2}	{}	\N	t	\N	any	parts	P1
SS14	QC In Progress	bg-blue-50 text-blue-600	qc	14	{S3}	{R1,R2}	{}	{}	\N	t	\N	any	qc	P1
SS15	QC Passed	bg-green-50 text-green-700	qc	15	{S3}	{R1,R2}	{R3}	{"S3": "S6"}	\N	t	\N	any	qc	P1
SS16	QC Failed	bg-red-50 text-red-600	qc	16	{S3}	{R1,R2}	{}	{}	\N	t	\N	any	qc	P1
SS17	Partial Fix	bg-yellow-50 text-yellow-700	qc	17	{S3}	{R1,R2}	{R3}	{}	\N	t	\N	any	qc	P1
SS18	Engineer Visit Requested	bg-orange-50 text-orange-600	escalated	18	{S4}	{R1,R2}	{R1}	{}	\N	t	\N	any	escalated	P1
SS19	Engineer Visit Scheduled	bg-blue-50 text-blue-600	escalated	19	{S4}	{R1}	{R2}	{}	\N	t	\N	any	escalated	P1
SS20	Engineer On-Site	bg-blue-50 text-blue-600	escalated	20	{S4}	{R1}	{R2}	{}	\N	t	\N	any	escalated	P1
SS21	Engineer Work Complete	bg-green-50 text-green-700	escalated	21	{S4}	{R1,R2}	{R1}	{"S4": "S3"}	\N	t	\N	any	escalated	P1
SS22	Pending Despatch	bg-orange-50 text-orange-700	escalated	22	{S4}	{R1,R2}	{R4}	{}	\N	t	\N	any	escalated	P1
SS23	Dispatched	bg-blue-50 text-blue-600	escalated	23	{S4}	{R1,R4}	{R1}	{}	\N	t	\N	any	escalated	P1
SS24	Received by Service Centre	bg-blue-50 text-blue-600	escalated	24	{S4}	{R1,R4}	{}	{}	\N	t	\N	any	escalated	P1
SS25	Being Repaired	bg-blue-50 text-blue-600	escalated	25	{S4}	{R1,R4}	{}	{}	\N	t	\N	any	escalated	P1
SS26	Service Centre Delayed	bg-red-50 text-red-600	escalated	26	{S4}	{R1,R4}	{R1}	{}	\N	t	\N	any	escalated	P1
SS27	Shipped Back to Us	bg-purple-50 text-purple-600	escalated	27	{S4}	{R1,R4}	{}	{}	\N	t	\N	any	escalated	P1
SS28	Received by Us	bg-green-50 text-green-700	escalated	28	{S4}	{R1,R4}	{R2}	{"S4": "S5"}	\N	t	\N	any	escalated	P1
SS29	Customer Notified	bg-green-50 text-green-700	ready	29	{S6}	{R1,R3}	{}	{}	\N	t	\N	any	ready	P1
SS30	Reminder Sent	bg-yellow-50 text-yellow-700	ready	30	{S6}	{R1,R3}	{}	{}	\N	t	\N	any	ready	P1
SS31	Uncollected - Action Needed	bg-red-50 text-red-600	ready	31	{S6}	{R1,R3}	{R1}	{}	\N	t	\N	any	ready	P1
SS32	Beyond Economical Repair	bg-red-50 text-red-600	no_fix	32	{S8}	{R1,R2}	{R3}	{}	\N	t	\N	any	no_fix	P1
SS33	Customer Informed	bg-gray-50 text-gray-600	no_fix	33	{S8}	{R1,R3}	{}	{}	\N	t	\N	any	no_fix	P1
SS34	Collecting Unrepaired	bg-gray-50 text-gray-600	no_fix	34	{S8}	{R1,R3}	{}	{"S8": "S7"}	\N	t	\N	any	no_fix	P1
SS35	Scrapped with Consent	bg-gray-50 text-gray-600	no_fix	35	{S8}	{R1,R3}	{R1}	{}	\N	t	\N	any	no_fix	P1
SS36	Warranty Voided - Customer Approval Needed	bg-red-100 text-red-600	customer_comm	36	{}	{}	{R3}	{}	Call customer - warranty void, confirm paid repair	t	\N	any	customer_comm	P1
SS37	Confirmed Under Warranty - Proceeding	bg-green-100 text-green-700	customer_comm	37	{}	{}	{R3}	{}	Inform customer - covered under warranty, no charge	t	\N	any	customer_comm	P1
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."User" (id, name, email, password, role, title, scope, "createdAt", "managerId", "avatarUrl", "coverUrl", phone, birthday, bio, "linkedIn", twitter, instagram, facebook) FROM stdin;
1	Admin	admin@networkservice.in	$2b$10$7SdUx1Lk7bxMq9ayjUc08./qmqjhsOCJEmbmir/U4c7EfdDgfE38a	R1	\N	OWN	2026-05-08 11:53:18.082	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
2	Technician	tech@networkservice.in	$2b$10$d24bANzpTTY6eWWgBgw3eO3cCSBr5lvzTT3/jp96NU7Ud9Oxn49PW	R2	\N	OWN	2026-05-08 11:53:18.371	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
3	Front Desk	front@networkservice.in	$2b$10$AxfxbJpGNt8wCu0Eo8ODVeIFbM176brMyldwE8lpmaDXzEnnUe6/q	R3	\N	OWN	2026-05-08 11:53:18.685	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
4	Despatch	des@networkservice.in	$2b$10$Ebp2lMChv//9ZoZdRTgynOyjP1JA6w8Eb4P5PtddKK963w7E8CMH2	R4	\N	OWN	2026-05-08 11:53:18.953	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: UserPermission; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."UserPermission" (id, "userId", "permissionId", type, reason, "expiresAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: UserPost; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."UserPost" ("userId", "postId", "createdAt") FROM stdin;
\.


--
-- Data for Name: Voucher; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."Voucher" (id, type, reference, date, status, narration, "partyAccountId", "partyName", "dueDate", "paymentMode", "placeOfSupply", subtotal, "taxAmount", "shippingAmt", "roundOff", "totalAmount", "amountPaid", "editVersion", "lastEditedAt", "lastEditedById", "shopOrderId", "ticketId", "postedAt", "cancelledAt", "cancelledById", "cancelReason", "deletedAt", "deletedById", "deleteReason", "createdById", "createdAt", "updatedAt", source) FROM stdin;
1	PURCHASE	PV-2026-0001	2026-03-23	POSTED	SAMPLE 50 keyboards purchased	49	SAMPLE Delta Distributors	2026-04-22	CREDIT	\N	40000.00	0.00	0.00	0.00	40000.00	0.00	0	\N	\N	\N	\N	2026-05-08 11:54:01.15	\N	\N	\N	\N	\N	\N	1	2026-05-08 11:53:59.623	2026-05-08 11:54:01.155	\N
2	SALE	SV-2026-0001	2026-05-08	DRAFT	SAMPLE draft for SAMPLE Acme Computers	46	SAMPLE Acme Computers	2026-06-07	\N	\N	1000.00	0.00	0.00	0.00	1000.00	0.00	0	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	\N	1	2026-05-08 11:54:01.652	2026-05-08 11:54:01.652	\N
3	SALE	SV-2026-0002	2026-05-02	POSTED	SAMPLE sent to SAMPLE Bharat IT Solutions	47	SAMPLE Bharat IT Solutions	2026-06-02	\N	\N	5000.00	900.00	0.00	0.00	5900.00	0.00	0	\N	\N	\N	\N	2026-05-08 11:54:03.735	\N	\N	\N	\N	\N	\N	1	2026-05-08 11:54:02.376	2026-05-08 11:54:03.736	\N
4	SALE	SV-2026-0003	2026-03-08	POSTED	SAMPLE overdue partial-paid to SAMPLE Coastal Systems	48	SAMPLE Coastal Systems	2026-04-07	\N	\N	12000.00	2160.00	0.00	0.00	14160.00	0.00	0	\N	\N	\N	\N	2026-05-08 11:54:05.663	\N	\N	\N	\N	\N	\N	1	2026-05-08 11:54:04.277	2026-05-08 11:54:05.664	\N
5	RECEIPT	REC-2026-0001	2026-04-17	POSTED	SAMPLE partial payment for SV-2026-0003	48	SAMPLE Coastal Systems	\N	BANK_TRANSFER	\N	5000.00	0.00	0.00	0.00	5000.00	0.00	0	\N	\N	\N	\N	2026-05-08 11:54:07.279	\N	\N	\N	\N	\N	\N	1	2026-05-08 11:54:06.161	2026-05-08 11:54:07.281	\N
6	RECEIPT	REC-2026-0002	2026-05-05	POSTED	SAMPLE advance from SAMPLE Acme Computers	46	SAMPLE Acme Computers	\N	CASH	\N	2000.00	0.00	0.00	0.00	2000.00	0.00	0	\N	\N	\N	\N	2026-05-08 11:54:09.045	\N	\N	\N	\N	\N	\N	1	2026-05-08 11:54:07.84	2026-05-08 11:54:09.046	\N
\.


--
-- Data for Name: VoucherAudit; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."VoucherAudit" (id, "voucherId", "originalRef", action, reason, snapshot, "actorId", "createdAt") FROM stdin;
\.


--
-- Data for Name: VoucherCounter; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."VoucherCounter" (id, "seriesId", "periodKey", "lastNumber", "updatedAt") FROM stdin;
1	8	2026	1	2026-05-08 11:53:59.463
2	9	2026	5	2026-05-08 11:56:07.512
5	5	2026	4	2026-05-08 11:56:09.817
\.


--
-- Data for Name: VoucherEditLog; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."VoucherEditLog" (id, "voucherId", version, "editedAt", "editedById", reason, before, after, "ipAddress", "userAgent") FROM stdin;
\.


--
-- Data for Name: VoucherLine; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."VoucherLine" (id, "voucherId", "accountId", type, amount, description, "productId", quantity, rate, "discountPct", "discountAmt", "taxRate", "taxAmount") FROM stdin;
1	1	29	DEBIT	40000.00	\N	14	50.000	800.00	\N	\N	\N	\N
2	1	49	CREDIT	40000.00	\N	\N	\N	\N	\N	\N	\N	\N
3	2	46	DEBIT	1000.00	\N	\N	\N	\N	\N	\N	\N	\N
4	2	11	CREDIT	1000.00	\N	\N	\N	\N	\N	\N	\N	\N
5	3	47	DEBIT	5900.00	\N	\N	\N	\N	\N	\N	\N	\N
6	3	11	CREDIT	5000.00	\N	\N	\N	\N	\N	\N	\N	\N
7	3	7	CREDIT	900.00	\N	\N	\N	\N	\N	\N	\N	\N
8	4	48	DEBIT	14160.00	\N	\N	\N	\N	\N	\N	\N	\N
9	4	11	CREDIT	12000.00	\N	\N	\N	\N	\N	\N	\N	\N
10	4	7	CREDIT	2160.00	\N	\N	\N	\N	\N	\N	\N	\N
11	5	2	DEBIT	5000.00	\N	\N	\N	\N	\N	\N	\N	\N
12	5	48	CREDIT	5000.00	\N	\N	\N	\N	\N	\N	\N	\N
13	6	2	DEBIT	2000.00	\N	\N	\N	\N	\N	\N	\N	\N
14	6	46	CREDIT	2000.00	\N	\N	\N	\N	\N	\N	\N	\N
\.


--
-- Data for Name: VoucherLineBillRef; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."VoucherLineBillRef" (id, "voucherLineId", "partyAccountId", "billRef", method, amount, "dueDate", "createdAt") FROM stdin;
1	2	49	PV-2026-0001	NEW_REF	40000.00	2026-04-22	2026-05-08 11:53:59.623
2	5	47	SV-2026-0002	NEW_REF	5900.00	2026-06-02	2026-05-08 11:54:02.376
3	8	48	SV-2026-0003	NEW_REF	14160.00	2026-04-07	2026-05-08 11:54:04.277
4	12	48	SV-2026-0003	AGAINST_REF	-5000.00	\N	2026-05-08 11:54:06.161
5	14	46	ADV-SAMPLE_Acme_Computers-001	ADVANCE	-2000.00	\N	2026-05-08 11:54:07.84
\.


--
-- Data for Name: VoucherSeries; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."VoucherSeries" (id, "seriesKey", label, format, "startNumber", "resetPolicy", "fyStartMonth", "isActive", "allowManualOverride", "isGstScoped", notes, "updatedById", "createdAt", "updatedAt") FROM stdin;
1	INVOICE	Sales Invoice	INV-{YYYY}-{####}	1	YEARLY	4	t	f	t	\N	\N	2026-05-08 11:53:41.439	2026-05-08 11:53:41.439
2	JOURNAL_ENTRY	Journal Entry	JE-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:41.663	2026-05-08 11:53:41.663
3	VOUCHER_CONTRA	Contra Voucher	CON-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:41.899	2026-05-08 11:53:41.899
4	VOUCHER_PAYMENT	Payment Voucher	PAY-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:42.105	2026-05-08 11:53:42.105
5	VOUCHER_RECEIPT	Receipt Voucher	REC-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:42.367	2026-05-08 11:53:42.367
6	VOUCHER_CREDIT_NOTE	Credit Note	CN-{YYYY}-{####}	1	YEARLY	4	t	f	t	\N	\N	2026-05-08 11:53:42.606	2026-05-08 11:53:42.606
7	VOUCHER_DEBIT_NOTE	Debit Note	DN-{YYYY}-{####}	1	YEARLY	4	t	f	t	\N	\N	2026-05-08 11:53:42.858	2026-05-08 11:53:42.858
8	INV_PURCHASE	Purchase Voucher	PV-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:43.117	2026-05-08 11:53:43.117
9	INV_SALE	Sale Stock Voucher	SV-{YYYY}-{####}	1	YEARLY	4	t	f	t	\N	\N	2026-05-08 11:53:43.297	2026-05-08 11:53:43.297
10	INV_ESTIMATE	Estimate / Quotation	EV-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:43.507	2026-05-08 11:53:43.507
11	INV_RECEIPT	Stock Receipt	RV-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:43.692	2026-05-08 11:53:43.692
12	INV_ISSUE	Stock Issue	IV-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:43.844	2026-05-08 11:53:43.844
13	INV_ADJUSTMENT	Stock Adjustment	AV-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:44.126	2026-05-08 11:53:44.126
14	INV_STOCK_JOURNAL	Stock Journal	SJ-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:44.443	2026-05-08 11:53:44.443
15	INV_PHYSICAL_STOCK	Physical Stock	PS-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:44.625	2026-05-08 11:53:44.625
16	INV_GRN	Goods Receipt Note	GRN-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:44.879	2026-05-08 11:53:44.879
17	INV_CHALLAN	Delivery Challan	DC-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:45.156	2026-05-08 11:53:45.156
18	INV_REJECTION_IN	Rejection In	RIN-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:45.346	2026-05-08 11:53:45.346
19	INV_REJECTION_OUT	Rejection Out	ROT-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:45.625	2026-05-08 11:53:45.625
20	INV_SALES_ORDER	Sales Order	SO-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:45.882	2026-05-08 11:53:45.882
21	INV_PURCHASE_ORDER	Purchase Order	PO-{YYYY}-{####}	1	YEARLY	4	t	f	f	\N	\N	2026-05-08 11:53:46.083	2026-05-08 11:53:46.083
\.


--
-- Data for Name: WallPost; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."WallPost" (id, "wallUserId", "authorId", body, "createdAt") FROM stdin;
\.


--
-- Data for Name: _BranchToUser; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."_BranchToUser" ("A", "B") FROM stdin;
\.


--
-- Data for Name: _DepartmentToUser; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public."_DepartmentToUser" ("A", "B") FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
e72f20d2-b2a0-4381-aaf8-f6090eac804b	9c14c916a1e6e97b63acddc8b07f876e57809ded65dd22b975247928d96a59dc	2026-05-08 11:34:57.811134+00	20260508113428_init_unified_voucher	\N	\N	2026-05-08 11:34:28.718669+00	1
dc7a4381-dd54-4a7a-996b-dace356dbf9d	20e2aa936c788b3e03d19ee8fddf8c2aa0462593a0fd6f803f68822cc9f27067	2026-05-08 15:31:33.68465+00	20260508153132_add_voucher_source	\N	\N	2026-05-08 15:31:33.108227+00	1
\.


--
-- Data for Name: messages_2026_05_05; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.messages_2026_05_05 (topic, extension, payload, event, private, updated_at, inserted_at, id) FROM stdin;
\.


--
-- Data for Name: messages_2026_05_06; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.messages_2026_05_06 (topic, extension, payload, event, private, updated_at, inserted_at, id) FROM stdin;
\.


--
-- Data for Name: messages_2026_05_07; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.messages_2026_05_07 (topic, extension, payload, event, private, updated_at, inserted_at, id) FROM stdin;
\.


--
-- Data for Name: messages_2026_05_08; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.messages_2026_05_08 (topic, extension, payload, event, private, updated_at, inserted_at, id) FROM stdin;
\.


--
-- Data for Name: messages_2026_05_09; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.messages_2026_05_09 (topic, extension, payload, event, private, updated_at, inserted_at, id) FROM stdin;
\.


--
-- Data for Name: messages_2026_05_10; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.messages_2026_05_10 (topic, extension, payload, event, private, updated_at, inserted_at, id) FROM stdin;
\.


--
-- Data for Name: messages_2026_05_11; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.messages_2026_05_11 (topic, extension, payload, event, private, updated_at, inserted_at, id) FROM stdin;
\.


--
-- Data for Name: schema_migrations; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.schema_migrations (version, inserted_at) FROM stdin;
20211116024918	2026-04-15 23:26:28
20211116045059	2026-04-15 23:26:29
20211116050929	2026-04-15 23:26:30
20211116051442	2026-04-15 23:26:30
20211116212300	2026-04-15 23:26:31
20211116213355	2026-04-15 23:26:32
20211116213934	2026-04-15 23:26:32
20211116214523	2026-04-15 23:26:33
20211122062447	2026-04-15 23:26:34
20211124070109	2026-04-15 23:26:34
20211202204204	2026-04-15 23:26:35
20211202204605	2026-04-15 23:26:36
20211210212804	2026-04-15 23:26:38
20211228014915	2026-04-15 23:26:38
20220107221237	2026-04-15 23:26:39
20220228202821	2026-04-15 23:26:40
20220312004840	2026-04-15 23:26:40
20220603231003	2026-04-15 23:26:41
20220603232444	2026-04-15 23:26:42
20220615214548	2026-04-15 23:26:43
20220712093339	2026-04-15 23:26:43
20220908172859	2026-04-15 23:26:44
20220916233421	2026-04-15 23:26:45
20230119133233	2026-04-15 23:26:45
20230128025114	2026-04-15 23:26:46
20230128025212	2026-04-15 23:26:47
20230227211149	2026-04-15 23:26:47
20230228184745	2026-04-15 23:26:48
20230308225145	2026-04-15 23:26:49
20230328144023	2026-04-15 23:26:49
20231018144023	2026-04-15 23:26:50
20231204144023	2026-04-15 23:26:51
20231204144024	2026-04-15 23:26:52
20231204144025	2026-04-15 23:26:52
20240108234812	2026-04-15 23:26:53
20240109165339	2026-04-15 23:26:54
20240227174441	2026-04-15 23:26:55
20240311171622	2026-04-15 23:26:56
20240321100241	2026-04-15 23:26:57
20240401105812	2026-04-15 23:26:59
20240418121054	2026-04-15 23:27:00
20240523004032	2026-04-15 23:27:02
20240618124746	2026-04-15 23:27:03
20240801235015	2026-04-15 23:27:03
20240805133720	2026-04-15 23:27:04
20240827160934	2026-04-15 23:27:05
20240919163303	2026-04-15 23:27:05
20240919163305	2026-04-15 23:27:06
20241019105805	2026-04-15 23:27:07
20241030150047	2026-04-15 23:27:09
20241108114728	2026-04-15 23:27:10
20241121104152	2026-04-15 23:27:11
20241130184212	2026-04-15 23:27:11
20241220035512	2026-04-15 23:27:12
20241220123912	2026-04-15 23:27:13
20241224161212	2026-04-15 23:27:13
20250107150512	2026-04-15 23:27:14
20250110162412	2026-04-15 23:27:15
20250123174212	2026-04-15 23:27:15
20250128220012	2026-04-15 23:27:16
20250506224012	2026-04-15 23:27:16
20250523164012	2026-04-15 23:27:17
20250714121412	2026-04-15 23:27:18
20250905041441	2026-04-15 23:27:18
20251103001201	2026-04-15 23:27:19
20251120212548	2026-04-15 23:27:20
20251120215549	2026-04-15 23:27:20
20260218120000	2026-04-15 23:27:21
20260326120000	2026-04-15 23:27:22
\.


--
-- Data for Name: subscription; Type: TABLE DATA; Schema: realtime; Owner: supabase_admin
--

COPY realtime.subscription (id, subscription_id, entity, filters, claims, created_at, action_filter) FROM stdin;
39	56bc9b02-41b1-11f1-ae77-0a58a9feac02	39321	{}	{"exp": 2091847883, "iat": 1776271883, "iss": "supabase", "ref": "gphtzbejvpijcfmvqpqo", "role": "anon"}	2026-04-26 20:48:54.570049	INSERT
40	56f09d6c-41b1-11f1-b5f4-0a58a9feac02	39321	{}	{"exp": 2091847883, "iat": 1776271883, "iss": "supabase", "ref": "gphtzbejvpijcfmvqpqo", "role": "anon"}	2026-04-26 20:48:54.91155	INSERT
\.


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.buckets (id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type) FROM stdin;
\.


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.buckets_analytics (name, type, format, created_at, updated_at, id, deleted_at) FROM stdin;
\.


--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.buckets_vectors (id, type, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: migrations; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.migrations (id, name, hash, executed_at) FROM stdin;
0	create-migrations-table	e18db593bcde2aca2a408c4d1100f6abba2195df	2026-04-15 16:53:27.682018
1	initialmigration	6ab16121fbaa08bbd11b712d05f358f9b555d777	2026-04-15 16:53:27.726905
2	storage-schema	f6a1fa2c93cbcd16d4e487b362e45fca157a8dbd	2026-04-15 16:53:27.729435
3	pathtoken-column	2cb1b0004b817b29d5b0a971af16bafeede4b70d	2026-04-15 16:53:27.753872
4	add-migrations-rls	427c5b63fe1c5937495d9c635c263ee7a5905058	2026-04-15 16:53:27.765785
5	add-size-functions	79e081a1455b63666c1294a440f8ad4b1e6a7f84	2026-04-15 16:53:27.76924
6	change-column-name-in-get-size	ded78e2f1b5d7e616117897e6443a925965b30d2	2026-04-15 16:53:27.773244
7	add-rls-to-buckets	e7e7f86adbc51049f341dfe8d30256c1abca17aa	2026-04-15 16:53:27.776934
8	add-public-to-buckets	fd670db39ed65f9d08b01db09d6202503ca2bab3	2026-04-15 16:53:27.780235
9	fix-search-function	af597a1b590c70519b464a4ab3be54490712796b	2026-04-15 16:53:27.783644
10	search-files-search-function	b595f05e92f7e91211af1bbfe9c6a13bb3391e16	2026-04-15 16:53:27.78707
11	add-trigger-to-auto-update-updated_at-column	7425bdb14366d1739fa8a18c83100636d74dcaa2	2026-04-15 16:53:27.793243
12	add-automatic-avif-detection-flag	8e92e1266eb29518b6a4c5313ab8f29dd0d08df9	2026-04-15 16:53:27.79736
13	add-bucket-custom-limits	cce962054138135cd9a8c4bcd531598684b25e7d	2026-04-15 16:53:27.802508
14	use-bytes-for-max-size	941c41b346f9802b411f06f30e972ad4744dad27	2026-04-15 16:53:27.807071
15	add-can-insert-object-function	934146bc38ead475f4ef4b555c524ee5d66799e5	2026-04-15 16:53:27.829636
16	add-version	76debf38d3fd07dcfc747ca49096457d95b1221b	2026-04-15 16:53:27.834935
17	drop-owner-foreign-key	f1cbb288f1b7a4c1eb8c38504b80ae2a0153d101	2026-04-15 16:53:27.839253
18	add_owner_id_column_deprecate_owner	e7a511b379110b08e2f214be852c35414749fe66	2026-04-15 16:53:27.843619
19	alter-default-value-objects-id	02e5e22a78626187e00d173dc45f58fa66a4f043	2026-04-15 16:53:27.849524
20	list-objects-with-delimiter	cd694ae708e51ba82bf012bba00caf4f3b6393b7	2026-04-15 16:53:27.853849
21	s3-multipart-uploads	8c804d4a566c40cd1e4cc5b3725a664a9303657f	2026-04-15 16:53:27.860538
22	s3-multipart-uploads-big-ints	9737dc258d2397953c9953d9b86920b8be0cdb73	2026-04-15 16:53:27.875532
23	optimize-search-function	9d7e604cddc4b56a5422dc68c9313f4a1b6f132c	2026-04-15 16:53:27.883797
24	operation-function	8312e37c2bf9e76bbe841aa5fda889206d2bf8aa	2026-04-15 16:53:27.888324
25	custom-metadata	d974c6057c3db1c1f847afa0e291e6165693b990	2026-04-15 16:53:27.892486
26	objects-prefixes	215cabcb7f78121892a5a2037a09fedf9a1ae322	2026-04-15 16:53:27.8962
27	search-v2	859ba38092ac96eb3964d83bf53ccc0b141663a6	2026-04-15 16:53:27.899597
28	object-bucket-name-sorting	c73a2b5b5d4041e39705814fd3a1b95502d38ce4	2026-04-15 16:53:27.902688
29	create-prefixes	ad2c1207f76703d11a9f9007f821620017a66c21	2026-04-15 16:53:27.905924
30	update-object-levels	2be814ff05c8252fdfdc7cfb4b7f5c7e17f0bed6	2026-04-15 16:53:27.90902
31	objects-level-index	b40367c14c3440ec75f19bbce2d71e914ddd3da0	2026-04-15 16:53:27.912142
32	backward-compatible-index-on-objects	e0c37182b0f7aee3efd823298fb3c76f1042c0f7	2026-04-15 16:53:27.915366
33	backward-compatible-index-on-prefixes	b480e99ed951e0900f033ec4eb34b5bdcb4e3d49	2026-04-15 16:53:27.918707
34	optimize-search-function-v1	ca80a3dc7bfef894df17108785ce29a7fc8ee456	2026-04-15 16:53:27.922069
35	add-insert-trigger-prefixes	458fe0ffd07ec53f5e3ce9df51bfdf4861929ccc	2026-04-15 16:53:27.925309
36	optimise-existing-functions	6ae5fca6af5c55abe95369cd4f93985d1814ca8f	2026-04-15 16:53:27.928737
37	add-bucket-name-length-trigger	3944135b4e3e8b22d6d4cbb568fe3b0b51df15c1	2026-04-15 16:53:27.932254
38	iceberg-catalog-flag-on-buckets	02716b81ceec9705aed84aa1501657095b32e5c5	2026-04-15 16:53:27.936666
39	add-search-v2-sort-support	6706c5f2928846abee18461279799ad12b279b78	2026-04-15 16:53:27.946635
40	fix-prefix-race-conditions-optimized	7ad69982ae2d372b21f48fc4829ae9752c518f6b	2026-04-15 16:53:27.949691
41	add-object-level-update-trigger	07fcf1a22165849b7a029deed059ffcde08d1ae0	2026-04-15 16:53:27.95274
42	rollback-prefix-triggers	771479077764adc09e2ea2043eb627503c034cd4	2026-04-15 16:53:27.96946
43	fix-object-level	84b35d6caca9d937478ad8a797491f38b8c2979f	2026-04-15 16:53:27.987689
44	vector-bucket-type	99c20c0ffd52bb1ff1f32fb992f3b351e3ef8fb3	2026-04-15 16:53:27.990482
45	vector-buckets	049e27196d77a7cb76497a85afae669d8b230953	2026-04-15 16:53:27.993978
46	buckets-objects-grants	fedeb96d60fefd8e02ab3ded9fbde05632f84aed	2026-04-15 16:53:28.003615
47	iceberg-table-metadata	649df56855c24d8b36dd4cc1aeb8251aa9ad42c2	2026-04-15 16:53:28.00695
48	iceberg-catalog-ids	e0e8b460c609b9999ccd0df9ad14294613eed939	2026-04-15 16:53:28.009804
49	buckets-objects-grants-postgres	072b1195d0d5a2f888af6b2302a1938dd94b8b3d	2026-04-15 16:53:28.025404
50	search-v2-optimised	6323ac4f850aa14e7387eb32102869578b5bd478	2026-04-15 16:53:28.028786
51	index-backward-compatible-search	2ee395d433f76e38bcd3856debaf6e0e5b674011	2026-04-15 16:53:28.929852
52	drop-not-used-indexes-and-functions	5cc44c8696749ac11dd0dc37f2a3802075f3a171	2026-04-15 16:53:28.931484
53	drop-index-lower-name	d0cb18777d9e2a98ebe0bc5cc7a42e57ebe41854	2026-04-15 16:53:28.939878
54	drop-index-object-level	6289e048b1472da17c31a7eba1ded625a6457e67	2026-04-15 16:53:28.942153
55	prevent-direct-deletes	262a4798d5e0f2e7c8970232e03ce8be695d5819	2026-04-15 16:53:28.943774
57	s3-multipart-uploads-metadata	f127886e00d1b374fadbc7c6b31e09336aad5287	2026-04-15 16:53:28.951532
58	operation-ergonomics	00ca5d483b3fe0d522133d9002ccc5df98365120	2026-04-15 16:53:28.954448
56	fix-optimized-search-function	b823ed1e418101032fa01374edc9a436e54e3ed4	2026-04-15 16:53:28.947556
59	drop-unused-functions	38456f13e39691c2bbb4b5151d0d1cdbabd4a8c4	2026-05-08 08:47:46.957907
60	optimize-existing-functions-again	db35e1c91a9201e59f4fef8d972c2f277d68b157	2026-05-08 08:47:46.969608
\.


--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.objects (id, bucket_id, name, owner, created_at, updated_at, last_accessed_at, metadata, version, owner_id, user_metadata) FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.s3_multipart_uploads (id, in_progress_size, upload_signature, bucket_id, key, version, owner_id, created_at, user_metadata, metadata) FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.s3_multipart_uploads_parts (id, upload_id, size, part_number, bucket_id, key, etag, owner_id, version, created_at) FROM stdin;
\.


--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY storage.vector_indexes (id, name, bucket_id, data_type, dimension, distance_metric, metadata_configuration, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: secrets; Type: TABLE DATA; Schema: vault; Owner: supabase_admin
--

COPY vault.secrets (id, name, description, secret, key_id, nonce, created_at, updated_at) FROM stdin;
\.


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('auth.refresh_tokens_id_seq', 1, false);


--
-- Name: AccountGroup_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."AccountGroup_id_seq"', 28, true);


--
-- Name: Account_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Account_id_seq"', 52, true);


--
-- Name: BookPeriod_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."BookPeriod_id_seq"', 1, true);


--
-- Name: ChatMessage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."ChatMessage_id_seq"', 1, false);


--
-- Name: ChatRoomMember_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."ChatRoomMember_id_seq"', 4, true);


--
-- Name: Company_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Company_id_seq"', 2, true);


--
-- Name: CrmLead_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."CrmLead_id_seq"', 1, false);


--
-- Name: Device_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Device_id_seq"', 1, false);


--
-- Name: Email_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Email_id_seq"', 1, false);


--
-- Name: InvBrand_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvBrand_id_seq"', 1, false);


--
-- Name: InvCategory_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvCategory_id_seq"', 1, false);


--
-- Name: InvProductGroup_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvProductGroup_id_seq"', 1, false);


--
-- Name: InvProduct_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvProduct_id_seq"', 14, true);


--
-- Name: InvStockLedger_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvStockLedger_id_seq"', 1, true);


--
-- Name: InvUnit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvUnit_id_seq"', 1, true);


--
-- Name: InvWarrantyTerm_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."InvWarrantyTerm_id_seq"', 1, false);


--
-- Name: PersonCompany_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."PersonCompany_id_seq"', 1, false);


--
-- Name: PersonPortalCredential_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."PersonPortalCredential_id_seq"', 1, false);


--
-- Name: Person_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Person_id_seq"', 5, true);


--
-- Name: Phone_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Phone_id_seq"', 1, false);


--
-- Name: ServiceCenter_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."ServiceCenter_id_seq"', 1, false);


--
-- Name: ShopOrderLine_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."ShopOrderLine_id_seq"', 1, false);


--
-- Name: ShopOrder_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."ShopOrder_id_seq"', 1, false);


--
-- Name: StatusTransition_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."StatusTransition_id_seq"', 24, true);


--
-- Name: SubStatusTransition_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."SubStatusTransition_id_seq"', 47, true);


--
-- Name: TicketLog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."TicketLog_id_seq"', 1, false);


--
-- Name: TicketParticipant_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."TicketParticipant_id_seq"', 1, false);


--
-- Name: Ticket_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Ticket_id_seq"', 1, false);


--
-- Name: UserPermission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."UserPermission_id_seq"', 1, false);


--
-- Name: User_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."User_id_seq"', 4, true);


--
-- Name: VoucherAudit_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."VoucherAudit_id_seq"', 1, false);


--
-- Name: VoucherCounter_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."VoucherCounter_id_seq"', 12, true);


--
-- Name: VoucherEditLog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."VoucherEditLog_id_seq"', 2, true);


--
-- Name: VoucherLineBillRef_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."VoucherLineBillRef_id_seq"', 11, true);


--
-- Name: VoucherLine_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."VoucherLine_id_seq"', 34, true);


--
-- Name: VoucherSeries_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."VoucherSeries_id_seq"', 21, true);


--
-- Name: Voucher_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."Voucher_id_seq"', 12, true);


--
-- Name: WallPost_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public."WallPost_id_seq"', 1, false);


--
-- Name: subscription_id_seq; Type: SEQUENCE SET; Schema: realtime; Owner: supabase_admin
--

SELECT pg_catalog.setval('realtime.subscription_id_seq', 40, true);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: AccountGroup AccountGroup_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AccountGroup"
    ADD CONSTRAINT "AccountGroup_pkey" PRIMARY KEY (id);


--
-- Name: Account Account_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_pkey" PRIMARY KEY (id);


--
-- Name: BookPeriod BookPeriod_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BookPeriod"
    ADD CONSTRAINT "BookPeriod_pkey" PRIMARY KEY (id);


--
-- Name: Branch Branch_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Branch"
    ADD CONSTRAINT "Branch_pkey" PRIMARY KEY (id);


--
-- Name: ChatMessage ChatMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_pkey" PRIMARY KEY (id);


--
-- Name: ChatRoomMember ChatRoomMember_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatRoomMember"
    ADD CONSTRAINT "ChatRoomMember_pkey" PRIMARY KEY (id);


--
-- Name: ChatRoom ChatRoom_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatRoom"
    ADD CONSTRAINT "ChatRoom_pkey" PRIMARY KEY (id);


--
-- Name: Company Company_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Company"
    ADD CONSTRAINT "Company_pkey" PRIMARY KEY (id);


--
-- Name: CrmLead CrmLead_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead"
    ADD CONSTRAINT "CrmLead_pkey" PRIMARY KEY (id);


--
-- Name: Department Department_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Department"
    ADD CONSTRAINT "Department_pkey" PRIMARY KEY (id);


--
-- Name: Device Device_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Device"
    ADD CONSTRAINT "Device_pkey" PRIMARY KEY (id);


--
-- Name: Email Email_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Email"
    ADD CONSTRAINT "Email_pkey" PRIMARY KEY (id);


--
-- Name: InvBrand InvBrand_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvBrand"
    ADD CONSTRAINT "InvBrand_pkey" PRIMARY KEY (id);


--
-- Name: InvCategory InvCategory_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvCategory"
    ADD CONSTRAINT "InvCategory_pkey" PRIMARY KEY (id);


--
-- Name: InvProductGroup InvProductGroup_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProductGroup"
    ADD CONSTRAINT "InvProductGroup_pkey" PRIMARY KEY (id);


--
-- Name: InvProduct InvProduct_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProduct"
    ADD CONSTRAINT "InvProduct_pkey" PRIMARY KEY (id);


--
-- Name: InvStockLedger InvStockLedger_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvStockLedger"
    ADD CONSTRAINT "InvStockLedger_pkey" PRIMARY KEY (id);


--
-- Name: InvUnit InvUnit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvUnit"
    ADD CONSTRAINT "InvUnit_pkey" PRIMARY KEY (id);


--
-- Name: InvWarrantyTerm InvWarrantyTerm_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvWarrantyTerm"
    ADD CONSTRAINT "InvWarrantyTerm_pkey" PRIMARY KEY (id);


--
-- Name: Permission Permission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Permission"
    ADD CONSTRAINT "Permission_pkey" PRIMARY KEY (id);


--
-- Name: PersonCompany PersonCompany_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PersonCompany"
    ADD CONSTRAINT "PersonCompany_pkey" PRIMARY KEY (id);


--
-- Name: PersonPortalCredential PersonPortalCredential_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PersonPortalCredential"
    ADD CONSTRAINT "PersonPortalCredential_pkey" PRIMARY KEY (id);


--
-- Name: Person Person_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Person"
    ADD CONSTRAINT "Person_pkey" PRIMARY KEY (id);


--
-- Name: Phone Phone_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Phone"
    ADD CONSTRAINT "Phone_pkey" PRIMARY KEY (id);


--
-- Name: Pipeline Pipeline_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Pipeline"
    ADD CONSTRAINT "Pipeline_pkey" PRIMARY KEY (id);


--
-- Name: Post Post_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_pkey" PRIMARY KEY (id);


--
-- Name: RolePermission RolePermission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId", "permissionId");


--
-- Name: Role Role_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Role"
    ADD CONSTRAINT "Role_pkey" PRIMARY KEY (id);


--
-- Name: ServiceCenter ServiceCenter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ServiceCenter"
    ADD CONSTRAINT "ServiceCenter_pkey" PRIMARY KEY (id);


--
-- Name: ShopCoupon ShopCoupon_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopCoupon"
    ADD CONSTRAINT "ShopCoupon_pkey" PRIMARY KEY (id);


--
-- Name: ShopOrderLine ShopOrderLine_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrderLine"
    ADD CONSTRAINT "ShopOrderLine_pkey" PRIMARY KEY (id);


--
-- Name: ShopOrder ShopOrder_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrder"
    ADD CONSTRAINT "ShopOrder_pkey" PRIMARY KEY (id);


--
-- Name: StatusTransition StatusTransition_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StatusTransition"
    ADD CONSTRAINT "StatusTransition_pkey" PRIMARY KEY (id);


--
-- Name: SubStatusGroup SubStatusGroup_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SubStatusGroup"
    ADD CONSTRAINT "SubStatusGroup_pkey" PRIMARY KEY (id);


--
-- Name: SubStatusTransition SubStatusTransition_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SubStatusTransition"
    ADD CONSTRAINT "SubStatusTransition_pkey" PRIMARY KEY (id);


--
-- Name: TicketLog TicketLog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketLog"
    ADD CONSTRAINT "TicketLog_pkey" PRIMARY KEY (id);


--
-- Name: TicketParticipant TicketParticipant_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketParticipant"
    ADD CONSTRAINT "TicketParticipant_pkey" PRIMARY KEY (id);


--
-- Name: TicketStatus TicketStatus_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketStatus"
    ADD CONSTRAINT "TicketStatus_pkey" PRIMARY KEY (id);


--
-- Name: TicketSubStatus TicketSubStatus_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketSubStatus"
    ADD CONSTRAINT "TicketSubStatus_pkey" PRIMARY KEY (id);


--
-- Name: Ticket Ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_pkey" PRIMARY KEY (id);


--
-- Name: UserPermission UserPermission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserPermission"
    ADD CONSTRAINT "UserPermission_pkey" PRIMARY KEY (id);


--
-- Name: UserPost UserPost_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserPost"
    ADD CONSTRAINT "UserPost_pkey" PRIMARY KEY ("userId", "postId");


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: VoucherAudit VoucherAudit_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherAudit"
    ADD CONSTRAINT "VoucherAudit_pkey" PRIMARY KEY (id);


--
-- Name: VoucherCounter VoucherCounter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherCounter"
    ADD CONSTRAINT "VoucherCounter_pkey" PRIMARY KEY (id);


--
-- Name: VoucherEditLog VoucherEditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherEditLog"
    ADD CONSTRAINT "VoucherEditLog_pkey" PRIMARY KEY (id);


--
-- Name: VoucherLineBillRef VoucherLineBillRef_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLineBillRef"
    ADD CONSTRAINT "VoucherLineBillRef_pkey" PRIMARY KEY (id);


--
-- Name: VoucherLine VoucherLine_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLine"
    ADD CONSTRAINT "VoucherLine_pkey" PRIMARY KEY (id);


--
-- Name: VoucherSeries VoucherSeries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherSeries"
    ADD CONSTRAINT "VoucherSeries_pkey" PRIMARY KEY (id);


--
-- Name: Voucher Voucher_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_pkey" PRIMARY KEY (id);


--
-- Name: WallPost WallPost_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WallPost"
    ADD CONSTRAINT "WallPost_pkey" PRIMARY KEY (id);


--
-- Name: _BranchToUser _BranchToUser_AB_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_BranchToUser"
    ADD CONSTRAINT "_BranchToUser_AB_pkey" PRIMARY KEY ("A", "B");


--
-- Name: _DepartmentToUser _DepartmentToUser_AB_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_DepartmentToUser"
    ADD CONSTRAINT "_DepartmentToUser_AB_pkey" PRIMARY KEY ("A", "B");


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_05 messages_2026_05_05_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages_2026_05_05
    ADD CONSTRAINT messages_2026_05_05_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_06 messages_2026_05_06_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages_2026_05_06
    ADD CONSTRAINT messages_2026_05_06_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_07 messages_2026_05_07_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages_2026_05_07
    ADD CONSTRAINT messages_2026_05_07_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_08 messages_2026_05_08_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages_2026_05_08
    ADD CONSTRAINT messages_2026_05_08_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_09 messages_2026_05_09_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages_2026_05_09
    ADD CONSTRAINT messages_2026_05_09_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_10 messages_2026_05_10_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages_2026_05_10
    ADD CONSTRAINT messages_2026_05_10_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_05_11 messages_2026_05_11_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.messages_2026_05_11
    ADD CONSTRAINT messages_2026_05_11_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: supabase_admin
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: idx_users_created_at_desc; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);


--
-- Name: idx_users_email; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_users_email ON auth.users USING btree (email);


--
-- Name: idx_users_last_sign_in_at_desc; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);


--
-- Name: idx_users_name; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: supabase_auth_admin
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: supabase_auth_admin
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: AccountGroup_parentId_sortOrder_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "AccountGroup_parentId_sortOrder_idx" ON public."AccountGroup" USING btree ("parentId", "sortOrder");


--
-- Name: AccountGroup_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "AccountGroup_type_idx" ON public."AccountGroup" USING btree (type);


--
-- Name: Account_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Account_code_key" ON public."Account" USING btree (code);


--
-- Name: Account_companyId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_companyId_idx" ON public."Account" USING btree ("companyId");


--
-- Name: Account_companyId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Account_companyId_key" ON public."Account" USING btree ("companyId");


--
-- Name: Account_groupId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_groupId_idx" ON public."Account" USING btree ("groupId");


--
-- Name: Account_isActive_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_isActive_idx" ON public."Account" USING btree ("isActive");


--
-- Name: Account_personId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_personId_idx" ON public."Account" USING btree ("personId");


--
-- Name: Account_personId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Account_personId_key" ON public."Account" USING btree ("personId");


--
-- Name: Account_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Account_type_idx" ON public."Account" USING btree (type);


--
-- Name: BookPeriod_fromDate_toDate_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "BookPeriod_fromDate_toDate_idx" ON public."BookPeriod" USING btree ("fromDate", "toDate");


--
-- Name: BookPeriod_isLocked_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "BookPeriod_isLocked_idx" ON public."BookPeriod" USING btree ("isLocked");


--
-- Name: ChatMessage_roomId_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ChatMessage_roomId_createdAt_idx" ON public."ChatMessage" USING btree ("roomId", "createdAt");


--
-- Name: ChatMessage_senderUserId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ChatMessage_senderUserId_idx" ON public."ChatMessage" USING btree ("senderUserId");


--
-- Name: ChatRoomMember_roomId_userId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ChatRoomMember_roomId_userId_key" ON public."ChatRoomMember" USING btree ("roomId", "userId");


--
-- Name: ChatRoomMember_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ChatRoomMember_userId_idx" ON public."ChatRoomMember" USING btree ("userId");


--
-- Name: ChatRoom_key_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ChatRoom_key_key" ON public."ChatRoom" USING btree (key);


--
-- Name: ChatRoom_ownerUserId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ChatRoom_ownerUserId_idx" ON public."ChatRoom" USING btree ("ownerUserId");


--
-- Name: ChatRoom_roleId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ChatRoom_roleId_idx" ON public."ChatRoom" USING btree ("roleId");


--
-- Name: ChatRoom_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ChatRoom_type_idx" ON public."ChatRoom" USING btree (type);


--
-- Name: CrmLead_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CrmLead_createdAt_idx" ON public."CrmLead" USING btree ("createdAt");


--
-- Name: CrmLead_ownerUserId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CrmLead_ownerUserId_idx" ON public."CrmLead" USING btree ("ownerUserId");


--
-- Name: CrmLead_pipelineId_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "CrmLead_pipelineId_status_idx" ON public."CrmLead" USING btree ("pipelineId", status);


--
-- Name: Device_accountId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Device_accountId_idx" ON public."Device" USING btree ("accountId");


--
-- Name: Email_companyId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Email_companyId_idx" ON public."Email" USING btree ("companyId");


--
-- Name: Email_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Email_email_key" ON public."Email" USING btree (email);


--
-- Name: Email_personId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Email_personId_idx" ON public."Email" USING btree ("personId");


--
-- Name: InvBrand_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "InvBrand_name_key" ON public."InvBrand" USING btree (name);


--
-- Name: InvCategory_parentId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvCategory_parentId_idx" ON public."InvCategory" USING btree ("parentId");


--
-- Name: InvCategory_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "InvCategory_slug_key" ON public."InvCategory" USING btree (slug);


--
-- Name: InvProductGroup_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "InvProductGroup_name_key" ON public."InvProductGroup" USING btree (name);


--
-- Name: InvProduct_brandId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvProduct_brandId_idx" ON public."InvProduct" USING btree ("brandId");


--
-- Name: InvProduct_categoryId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvProduct_categoryId_idx" ON public."InvProduct" USING btree ("categoryId");


--
-- Name: InvProduct_groupId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvProduct_groupId_idx" ON public."InvProduct" USING btree ("groupId");


--
-- Name: InvProduct_isListedInShop_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvProduct_isListedInShop_idx" ON public."InvProduct" USING btree ("isListedInShop");


--
-- Name: InvProduct_sku_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "InvProduct_sku_key" ON public."InvProduct" USING btree (sku);


--
-- Name: InvProduct_slug_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "InvProduct_slug_key" ON public."InvProduct" USING btree (slug);


--
-- Name: InvProduct_unitId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvProduct_unitId_idx" ON public."InvProduct" USING btree ("unitId");


--
-- Name: InvProduct_warrantyTermId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvProduct_warrantyTermId_idx" ON public."InvProduct" USING btree ("warrantyTermId");


--
-- Name: InvStockLedger_productId_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvStockLedger_productId_date_idx" ON public."InvStockLedger" USING btree ("productId", date);


--
-- Name: InvStockLedger_voucherId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "InvStockLedger_voucherId_idx" ON public."InvStockLedger" USING btree ("voucherId");


--
-- Name: InvUnit_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "InvUnit_code_key" ON public."InvUnit" USING btree (code);


--
-- Name: PersonCompany_companyId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "PersonCompany_companyId_idx" ON public."PersonCompany" USING btree ("companyId");


--
-- Name: PersonCompany_personId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "PersonCompany_personId_idx" ON public."PersonCompany" USING btree ("personId");


--
-- Name: PersonPortalCredential_emailNormalized_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "PersonPortalCredential_emailNormalized_key" ON public."PersonPortalCredential" USING btree ("emailNormalized");


--
-- Name: PersonPortalCredential_personId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "PersonPortalCredential_personId_idx" ON public."PersonPortalCredential" USING btree ("personId");


--
-- Name: PersonPortalCredential_personId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "PersonPortalCredential_personId_key" ON public."PersonPortalCredential" USING btree ("personId");


--
-- Name: PersonPortalCredential_phoneNormalized_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "PersonPortalCredential_phoneNormalized_key" ON public."PersonPortalCredential" USING btree ("phoneNormalized");


--
-- Name: Phone_companyId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Phone_companyId_idx" ON public."Phone" USING btree ("companyId");


--
-- Name: Phone_personId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Phone_personId_idx" ON public."Phone" USING btree ("personId");


--
-- Name: Phone_phone_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Phone_phone_key" ON public."Phone" USING btree (phone);


--
-- Name: Pipeline_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Pipeline_name_key" ON public."Pipeline" USING btree (name);


--
-- Name: ShopCoupon_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ShopCoupon_code_key" ON public."ShopCoupon" USING btree (code);


--
-- Name: ShopOrderLine_orderId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrderLine_orderId_idx" ON public."ShopOrderLine" USING btree ("orderId");


--
-- Name: ShopOrderLine_productId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrderLine_productId_idx" ON public."ShopOrderLine" USING btree ("productId");


--
-- Name: ShopOrder_accountId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrder_accountId_idx" ON public."ShopOrder" USING btree ("accountId");


--
-- Name: ShopOrder_personId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrder_personId_idx" ON public."ShopOrder" USING btree ("personId");


--
-- Name: ShopOrder_pipelineId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrder_pipelineId_idx" ON public."ShopOrder" USING btree ("pipelineId");


--
-- Name: ShopOrder_razorpayOrderId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "ShopOrder_razorpayOrderId_key" ON public."ShopOrder" USING btree ("razorpayOrderId");


--
-- Name: ShopOrder_sourceCouponId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrder_sourceCouponId_idx" ON public."ShopOrder" USING btree ("sourceCouponId");


--
-- Name: ShopOrder_statusId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrder_statusId_idx" ON public."ShopOrder" USING btree ("statusId");


--
-- Name: ShopOrder_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "ShopOrder_status_idx" ON public."ShopOrder" USING btree (status);


--
-- Name: StatusTransition_fromStatusId_toStatusId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "StatusTransition_fromStatusId_toStatusId_key" ON public."StatusTransition" USING btree ("fromStatusId", "toStatusId");


--
-- Name: SubStatusTransition_fromSubStatusId_toSubStatusId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "SubStatusTransition_fromSubStatusId_toSubStatusId_key" ON public."SubStatusTransition" USING btree ("fromSubStatusId", "toSubStatusId");


--
-- Name: TicketLog_ticketId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "TicketLog_ticketId_idx" ON public."TicketLog" USING btree ("ticketId");


--
-- Name: TicketLog_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "TicketLog_userId_idx" ON public."TicketLog" USING btree ("userId");


--
-- Name: TicketParticipant_ticketId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "TicketParticipant_ticketId_idx" ON public."TicketParticipant" USING btree ("ticketId");


--
-- Name: TicketParticipant_ticketId_userId_addedBySubStatusId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "TicketParticipant_ticketId_userId_addedBySubStatusId_key" ON public."TicketParticipant" USING btree ("ticketId", "userId", "addedBySubStatusId");


--
-- Name: TicketParticipant_userId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "TicketParticipant_userId_idx" ON public."TicketParticipant" USING btree ("userId");


--
-- Name: Ticket_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Ticket_createdAt_idx" ON public."Ticket" USING btree ("createdAt");


--
-- Name: Ticket_deviceId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Ticket_deviceId_idx" ON public."Ticket" USING btree ("deviceId");


--
-- Name: Ticket_pipelineId_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Ticket_pipelineId_status_idx" ON public."Ticket" USING btree ("pipelineId", status);


--
-- Name: Ticket_primaryOwnerId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Ticket_primaryOwnerId_idx" ON public."Ticket" USING btree ("primaryOwnerId");


--
-- Name: Ticket_sourceShopOrderId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Ticket_sourceShopOrderId_idx" ON public."Ticket" USING btree ("sourceShopOrderId");


--
-- Name: Ticket_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Ticket_status_idx" ON public."Ticket" USING btree (status);


--
-- Name: Ticket_warrantyStatus_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Ticket_warrantyStatus_idx" ON public."Ticket" USING btree ("warrantyStatus");


--
-- Name: UserPermission_userId_permissionId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "UserPermission_userId_permissionId_key" ON public."UserPermission" USING btree ("userId", "permissionId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: VoucherAudit_actorId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherAudit_actorId_idx" ON public."VoucherAudit" USING btree ("actorId");


--
-- Name: VoucherAudit_createdAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherAudit_createdAt_idx" ON public."VoucherAudit" USING btree ("createdAt");


--
-- Name: VoucherAudit_voucherId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherAudit_voucherId_idx" ON public."VoucherAudit" USING btree ("voucherId");


--
-- Name: VoucherCounter_seriesId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherCounter_seriesId_idx" ON public."VoucherCounter" USING btree ("seriesId");


--
-- Name: VoucherCounter_seriesId_periodKey_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "VoucherCounter_seriesId_periodKey_key" ON public."VoucherCounter" USING btree ("seriesId", "periodKey");


--
-- Name: VoucherEditLog_editedAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherEditLog_editedAt_idx" ON public."VoucherEditLog" USING btree ("editedAt");


--
-- Name: VoucherEditLog_voucherId_version_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherEditLog_voucherId_version_idx" ON public."VoucherEditLog" USING btree ("voucherId", version);


--
-- Name: VoucherLineBillRef_billRef_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherLineBillRef_billRef_idx" ON public."VoucherLineBillRef" USING btree ("billRef");


--
-- Name: VoucherLineBillRef_partyAccountId_billRef_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherLineBillRef_partyAccountId_billRef_idx" ON public."VoucherLineBillRef" USING btree ("partyAccountId", "billRef");


--
-- Name: VoucherLineBillRef_partyAccountId_method_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherLineBillRef_partyAccountId_method_idx" ON public."VoucherLineBillRef" USING btree ("partyAccountId", method);


--
-- Name: VoucherLine_accountId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherLine_accountId_idx" ON public."VoucherLine" USING btree ("accountId");


--
-- Name: VoucherLine_productId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherLine_productId_idx" ON public."VoucherLine" USING btree ("productId");


--
-- Name: VoucherLine_voucherId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherLine_voucherId_idx" ON public."VoucherLine" USING btree ("voucherId");


--
-- Name: VoucherSeries_isActive_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "VoucherSeries_isActive_idx" ON public."VoucherSeries" USING btree ("isActive");


--
-- Name: VoucherSeries_seriesKey_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "VoucherSeries_seriesKey_key" ON public."VoucherSeries" USING btree ("seriesKey");


--
-- Name: Voucher_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Voucher_date_idx" ON public."Voucher" USING btree (date);


--
-- Name: Voucher_deletedAt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Voucher_deletedAt_idx" ON public."Voucher" USING btree ("deletedAt");


--
-- Name: Voucher_partyAccountId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Voucher_partyAccountId_idx" ON public."Voucher" USING btree ("partyAccountId");


--
-- Name: Voucher_reference_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Voucher_reference_key" ON public."Voucher" USING btree (reference);


--
-- Name: Voucher_shopOrderId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Voucher_shopOrderId_idx" ON public."Voucher" USING btree ("shopOrderId");


--
-- Name: Voucher_shopOrderId_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "Voucher_shopOrderId_key" ON public."Voucher" USING btree ("shopOrderId");


--
-- Name: Voucher_source_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Voucher_source_idx" ON public."Voucher" USING btree (source);


--
-- Name: Voucher_ticketId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Voucher_ticketId_idx" ON public."Voucher" USING btree ("ticketId");


--
-- Name: Voucher_type_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "Voucher_type_status_idx" ON public."Voucher" USING btree (type, status);


--
-- Name: WallPost_authorId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "WallPost_authorId_idx" ON public."WallPost" USING btree ("authorId");


--
-- Name: WallPost_wallUserId_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "WallPost_wallUserId_idx" ON public."WallPost" USING btree ("wallUserId");


--
-- Name: _BranchToUser_B_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "_BranchToUser_B_index" ON public."_BranchToUser" USING btree ("B");


--
-- Name: _DepartmentToUser_B_index; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "_DepartmentToUser_B_index" ON public."_DepartmentToUser" USING btree ("B");


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: supabase_realtime_admin
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_05_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX messages_2026_05_05_inserted_at_topic_idx ON realtime.messages_2026_05_05 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_06_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX messages_2026_05_06_inserted_at_topic_idx ON realtime.messages_2026_05_06 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_07_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX messages_2026_05_07_inserted_at_topic_idx ON realtime.messages_2026_05_07 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_08_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX messages_2026_05_08_inserted_at_topic_idx ON realtime.messages_2026_05_08 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_09_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX messages_2026_05_09_inserted_at_topic_idx ON realtime.messages_2026_05_09 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_10_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX messages_2026_05_10_inserted_at_topic_idx ON realtime.messages_2026_05_10 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_05_11_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE INDEX messages_2026_05_11_inserted_at_topic_idx ON realtime.messages_2026_05_11 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_key; Type: INDEX; Schema: realtime; Owner: supabase_admin
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_key ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter);


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: supabase_storage_admin
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: messages_2026_05_05_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_05_inserted_at_topic_idx;


--
-- Name: messages_2026_05_05_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_05_pkey;


--
-- Name: messages_2026_05_06_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_06_inserted_at_topic_idx;


--
-- Name: messages_2026_05_06_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_06_pkey;


--
-- Name: messages_2026_05_07_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_07_inserted_at_topic_idx;


--
-- Name: messages_2026_05_07_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_07_pkey;


--
-- Name: messages_2026_05_08_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_08_inserted_at_topic_idx;


--
-- Name: messages_2026_05_08_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_08_pkey;


--
-- Name: messages_2026_05_09_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_09_inserted_at_topic_idx;


--
-- Name: messages_2026_05_09_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_09_pkey;


--
-- Name: messages_2026_05_10_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_10_inserted_at_topic_idx;


--
-- Name: messages_2026_05_10_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_10_pkey;


--
-- Name: messages_2026_05_11_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_05_11_inserted_at_topic_idx;


--
-- Name: messages_2026_05_11_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_05_11_pkey;


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: supabase_admin
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: supabase_storage_admin
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: AccountGroup AccountGroup_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."AccountGroup"
    ADD CONSTRAINT "AccountGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."AccountGroup"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Account Account_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Account Account_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public."AccountGroup"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Account Account_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Account Account_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Account"
    ADD CONSTRAINT "Account_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: BookPeriod BookPeriod_lockedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."BookPeriod"
    ADD CONSTRAINT "BookPeriod_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ChatMessage ChatMessage_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatMessage ChatMessage_senderUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatMessage"
    ADD CONSTRAINT "ChatMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ChatRoomMember ChatRoomMember_roomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatRoomMember"
    ADD CONSTRAINT "ChatRoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatRoomMember ChatRoomMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatRoomMember"
    ADD CONSTRAINT "ChatRoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatRoom ChatRoom_ownerUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatRoom"
    ADD CONSTRAINT "ChatRoom_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ChatRoom ChatRoom_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ChatRoom"
    ADD CONSTRAINT "ChatRoom_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CrmLead CrmLead_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead"
    ADD CONSTRAINT "CrmLead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CrmLead CrmLead_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead"
    ADD CONSTRAINT "CrmLead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CrmLead CrmLead_ownerUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead"
    ADD CONSTRAINT "CrmLead_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CrmLead CrmLead_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead"
    ADD CONSTRAINT "CrmLead_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: CrmLead CrmLead_pipelineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead"
    ADD CONSTRAINT "CrmLead_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES public."Pipeline"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: CrmLead CrmLead_status_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."CrmLead"
    ADD CONSTRAINT "CrmLead_status_fkey" FOREIGN KEY (status) REFERENCES public."TicketStatus"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Department Department_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Department"
    ADD CONSTRAINT "Department_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public."Branch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Device Device_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Device"
    ADD CONSTRAINT "Device_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Email Email_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Email"
    ADD CONSTRAINT "Email_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Email Email_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Email"
    ADD CONSTRAINT "Email_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: InvCategory InvCategory_parentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvCategory"
    ADD CONSTRAINT "InvCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES public."InvCategory"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvProduct InvProduct_brandId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProduct"
    ADD CONSTRAINT "InvProduct_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES public."InvBrand"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvProduct InvProduct_categoryId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProduct"
    ADD CONSTRAINT "InvProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES public."InvCategory"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvProduct InvProduct_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProduct"
    ADD CONSTRAINT "InvProduct_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public."InvProductGroup"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvProduct InvProduct_unitId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProduct"
    ADD CONSTRAINT "InvProduct_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES public."InvUnit"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: InvProduct InvProduct_warrantyTermId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvProduct"
    ADD CONSTRAINT "InvProduct_warrantyTermId_fkey" FOREIGN KEY ("warrantyTermId") REFERENCES public."InvWarrantyTerm"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: InvStockLedger InvStockLedger_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvStockLedger"
    ADD CONSTRAINT "InvStockLedger_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."InvProduct"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: InvStockLedger InvStockLedger_voucherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."InvStockLedger"
    ADD CONSTRAINT "InvStockLedger_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES public."Voucher"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PersonCompany PersonCompany_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PersonCompany"
    ADD CONSTRAINT "PersonCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PersonCompany PersonCompany_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PersonCompany"
    ADD CONSTRAINT "PersonCompany_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: PersonPortalCredential PersonPortalCredential_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."PersonPortalCredential"
    ADD CONSTRAINT "PersonPortalCredential_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Phone Phone_companyId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Phone"
    ADD CONSTRAINT "Phone_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES public."Company"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Phone Phone_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Phone"
    ADD CONSTRAINT "Phone_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Post Post_branchId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES public."Branch"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Post Post_departmentId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES public."Department"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Post Post_parentPostId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_parentPostId_fkey" FOREIGN KEY ("parentPostId") REFERENCES public."Post"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Post Post_roleTemplateId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Post"
    ADD CONSTRAINT "Post_roleTemplateId_fkey" FOREIGN KEY ("roleTemplateId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: RolePermission RolePermission_permissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES public."Permission"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: RolePermission RolePermission_roleId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."RolePermission"
    ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShopOrderLine ShopOrderLine_orderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrderLine"
    ADD CONSTRAINT "ShopOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES public."ShopOrder"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ShopOrderLine ShopOrderLine_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrderLine"
    ADD CONSTRAINT "ShopOrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."InvProduct"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ShopOrder ShopOrder_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrder"
    ADD CONSTRAINT "ShopOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ShopOrder ShopOrder_personId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrder"
    ADD CONSTRAINT "ShopOrder_personId_fkey" FOREIGN KEY ("personId") REFERENCES public."Person"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ShopOrder ShopOrder_pipelineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrder"
    ADD CONSTRAINT "ShopOrder_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES public."Pipeline"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ShopOrder ShopOrder_sourceCouponId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrder"
    ADD CONSTRAINT "ShopOrder_sourceCouponId_fkey" FOREIGN KEY ("sourceCouponId") REFERENCES public."ShopCoupon"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ShopOrder ShopOrder_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."ShopOrder"
    ADD CONSTRAINT "ShopOrder_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public."TicketStatus"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: StatusTransition StatusTransition_fromStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StatusTransition"
    ADD CONSTRAINT "StatusTransition_fromStatusId_fkey" FOREIGN KEY ("fromStatusId") REFERENCES public."TicketStatus"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusTransition StatusTransition_toStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."StatusTransition"
    ADD CONSTRAINT "StatusTransition_toStatusId_fkey" FOREIGN KEY ("toStatusId") REFERENCES public."TicketStatus"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SubStatusTransition SubStatusTransition_fromSubStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SubStatusTransition"
    ADD CONSTRAINT "SubStatusTransition_fromSubStatusId_fkey" FOREIGN KEY ("fromSubStatusId") REFERENCES public."TicketSubStatus"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SubStatusTransition SubStatusTransition_toSubStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."SubStatusTransition"
    ADD CONSTRAINT "SubStatusTransition_toSubStatusId_fkey" FOREIGN KEY ("toSubStatusId") REFERENCES public."TicketSubStatus"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TicketLog TicketLog_status_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketLog"
    ADD CONSTRAINT "TicketLog_status_fkey" FOREIGN KEY (status) REFERENCES public."TicketStatus"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TicketLog TicketLog_subStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketLog"
    ADD CONSTRAINT "TicketLog_subStatusId_fkey" FOREIGN KEY ("subStatusId") REFERENCES public."TicketSubStatus"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TicketLog TicketLog_ticketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketLog"
    ADD CONSTRAINT "TicketLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES public."Ticket"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TicketLog TicketLog_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketLog"
    ADD CONSTRAINT "TicketLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TicketParticipant TicketParticipant_addedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketParticipant"
    ADD CONSTRAINT "TicketParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TicketParticipant TicketParticipant_addedBySubStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketParticipant"
    ADD CONSTRAINT "TicketParticipant_addedBySubStatusId_fkey" FOREIGN KEY ("addedBySubStatusId") REFERENCES public."TicketSubStatus"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TicketParticipant TicketParticipant_ticketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketParticipant"
    ADD CONSTRAINT "TicketParticipant_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES public."Ticket"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: TicketParticipant TicketParticipant_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketParticipant"
    ADD CONSTRAINT "TicketParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TicketStatus TicketStatus_pipelineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketStatus"
    ADD CONSTRAINT "TicketStatus_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES public."Pipeline"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TicketSubStatus TicketSubStatus_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketSubStatus"
    ADD CONSTRAINT "TicketSubStatus_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public."SubStatusGroup"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: TicketSubStatus TicketSubStatus_pipelineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."TicketSubStatus"
    ADD CONSTRAINT "TicketSubStatus_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES public."Pipeline"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Ticket Ticket_billingAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Ticket Ticket_deviceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Ticket Ticket_pipelineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES public."Pipeline"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Ticket Ticket_primaryOwnerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_primaryOwnerId_fkey" FOREIGN KEY ("primaryOwnerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Ticket Ticket_serviceCenterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_serviceCenterId_fkey" FOREIGN KEY ("serviceCenterId") REFERENCES public."ServiceCenter"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Ticket Ticket_sourceShopOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_sourceShopOrderId_fkey" FOREIGN KEY ("sourceShopOrderId") REFERENCES public."ShopOrder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Ticket Ticket_status_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_status_fkey" FOREIGN KEY (status) REFERENCES public."TicketStatus"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Ticket Ticket_subStatusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Ticket"
    ADD CONSTRAINT "Ticket_subStatusId_fkey" FOREIGN KEY ("subStatusId") REFERENCES public."TicketSubStatus"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: UserPermission UserPermission_permissionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserPermission"
    ADD CONSTRAINT "UserPermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES public."Permission"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserPermission UserPermission_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserPermission"
    ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserPost UserPost_postId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserPost"
    ADD CONSTRAINT "UserPost_postId_fkey" FOREIGN KEY ("postId") REFERENCES public."Post"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: UserPost UserPost_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."UserPost"
    ADD CONSTRAINT "UserPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: User User_managerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: User User_role_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_role_fkey" FOREIGN KEY (role) REFERENCES public."Role"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VoucherAudit VoucherAudit_actorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherAudit"
    ADD CONSTRAINT "VoucherAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VoucherAudit VoucherAudit_voucherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherAudit"
    ADD CONSTRAINT "VoucherAudit_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES public."Voucher"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VoucherCounter VoucherCounter_seriesId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherCounter"
    ADD CONSTRAINT "VoucherCounter_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES public."VoucherSeries"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VoucherEditLog VoucherEditLog_editedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherEditLog"
    ADD CONSTRAINT "VoucherEditLog_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VoucherEditLog VoucherEditLog_voucherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherEditLog"
    ADD CONSTRAINT "VoucherEditLog_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES public."Voucher"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VoucherLineBillRef VoucherLineBillRef_partyAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLineBillRef"
    ADD CONSTRAINT "VoucherLineBillRef_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VoucherLineBillRef VoucherLineBillRef_voucherLineId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLineBillRef"
    ADD CONSTRAINT "VoucherLineBillRef_voucherLineId_fkey" FOREIGN KEY ("voucherLineId") REFERENCES public."VoucherLine"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VoucherLine VoucherLine_accountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLine"
    ADD CONSTRAINT "VoucherLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: VoucherLine VoucherLine_productId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLine"
    ADD CONSTRAINT "VoucherLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES public."InvProduct"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: VoucherLine VoucherLine_voucherId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."VoucherLine"
    ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES public."Voucher"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Voucher Voucher_cancelledById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Voucher Voucher_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Voucher Voucher_deletedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Voucher Voucher_lastEditedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Voucher Voucher_partyAccountId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_partyAccountId_fkey" FOREIGN KEY ("partyAccountId") REFERENCES public."Account"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Voucher Voucher_shopOrderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES public."ShopOrder"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Voucher Voucher_ticketId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."Voucher"
    ADD CONSTRAINT "Voucher_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES public."Ticket"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: WallPost WallPost_authorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WallPost"
    ADD CONSTRAINT "WallPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: WallPost WallPost_wallUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."WallPost"
    ADD CONSTRAINT "WallPost_wallUserId_fkey" FOREIGN KEY ("wallUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: _BranchToUser _BranchToUser_A_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_BranchToUser"
    ADD CONSTRAINT "_BranchToUser_A_fkey" FOREIGN KEY ("A") REFERENCES public."Branch"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _BranchToUser _BranchToUser_B_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_BranchToUser"
    ADD CONSTRAINT "_BranchToUser_B_fkey" FOREIGN KEY ("B") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _DepartmentToUser _DepartmentToUser_A_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_DepartmentToUser"
    ADD CONSTRAINT "_DepartmentToUser_A_fkey" FOREIGN KEY ("A") REFERENCES public."Department"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _DepartmentToUser _DepartmentToUser_B_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public."_DepartmentToUser"
    ADD CONSTRAINT "_DepartmentToUser_B_fkey" FOREIGN KEY ("B") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: supabase_auth_admin
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: supabase_realtime_admin
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: supabase_storage_admin
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: postgres
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION supabase_realtime OWNER TO postgres;

--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: supabase_admin
--

CREATE PUBLICATION supabase_realtime_messages_publication WITH (publish = 'insert, update, delete, truncate');


ALTER PUBLICATION supabase_realtime_messages_publication OWNER TO supabase_admin;

--
-- Name: supabase_realtime_messages_publication messages; Type: PUBLICATION TABLE; Schema: realtime; Owner: supabase_admin
--

ALTER PUBLICATION supabase_realtime_messages_publication ADD TABLE ONLY realtime.messages;


--
-- Name: SCHEMA auth; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA auth TO anon;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT USAGE ON SCHEMA auth TO service_role;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL ON SCHEMA auth TO dashboard_user;
GRANT USAGE ON SCHEMA auth TO postgres;


--
-- Name: SCHEMA extensions; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA extensions TO anon;
GRANT USAGE ON SCHEMA extensions TO authenticated;
GRANT USAGE ON SCHEMA extensions TO service_role;
GRANT ALL ON SCHEMA extensions TO dashboard_user;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO PUBLIC;


--
-- Name: SCHEMA realtime; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA realtime TO postgres;
GRANT USAGE ON SCHEMA realtime TO anon;
GRANT USAGE ON SCHEMA realtime TO authenticated;
GRANT USAGE ON SCHEMA realtime TO service_role;
GRANT ALL ON SCHEMA realtime TO supabase_realtime_admin;


--
-- Name: SCHEMA storage; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA storage TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA storage TO anon;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT USAGE ON SCHEMA storage TO service_role;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON SCHEMA storage TO dashboard_user;


--
-- Name: SCHEMA vault; Type: ACL; Schema: -; Owner: supabase_admin
--

GRANT USAGE ON SCHEMA vault TO postgres WITH GRANT OPTION;
GRANT USAGE ON SCHEMA vault TO service_role;


--
-- Name: FUNCTION email(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.email() TO dashboard_user;


--
-- Name: FUNCTION jwt(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.jwt() TO postgres;
GRANT ALL ON FUNCTION auth.jwt() TO dashboard_user;


--
-- Name: FUNCTION role(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.role() TO dashboard_user;


--
-- Name: FUNCTION uid(); Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON FUNCTION auth.uid() TO dashboard_user;


--
-- Name: FUNCTION armor(bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.armor(bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.armor(bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.armor(bytea) TO dashboard_user;


--
-- Name: FUNCTION armor(bytea, text[], text[]); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.armor(bytea, text[], text[]) FROM postgres;
GRANT ALL ON FUNCTION extensions.armor(bytea, text[], text[]) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.armor(bytea, text[], text[]) TO dashboard_user;


--
-- Name: FUNCTION crypt(text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.crypt(text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.crypt(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.crypt(text, text) TO dashboard_user;


--
-- Name: FUNCTION dearmor(text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.dearmor(text) FROM postgres;
GRANT ALL ON FUNCTION extensions.dearmor(text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.dearmor(text) TO dashboard_user;


--
-- Name: FUNCTION decrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.decrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION decrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.decrypt_iv(bytea, bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION digest(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.digest(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.digest(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.digest(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION digest(text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.digest(text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.digest(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.digest(text, text) TO dashboard_user;


--
-- Name: FUNCTION encrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.encrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION encrypt_iv(bytea, bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.encrypt_iv(bytea, bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION gen_random_bytes(integer); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_random_bytes(integer) FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_random_bytes(integer) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_random_bytes(integer) TO dashboard_user;


--
-- Name: FUNCTION gen_random_uuid(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_random_uuid() FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_random_uuid() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_random_uuid() TO dashboard_user;


--
-- Name: FUNCTION gen_salt(text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_salt(text) FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_salt(text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_salt(text) TO dashboard_user;


--
-- Name: FUNCTION gen_salt(text, integer); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.gen_salt(text, integer) FROM postgres;
GRANT ALL ON FUNCTION extensions.gen_salt(text, integer) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.gen_salt(text, integer) TO dashboard_user;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_cron_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_cron_access() TO dashboard_user;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.grant_pg_graphql_access() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION grant_pg_net_access(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION extensions.grant_pg_net_access() FROM supabase_admin;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO supabase_admin WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.grant_pg_net_access() TO dashboard_user;


--
-- Name: FUNCTION hmac(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.hmac(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.hmac(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.hmac(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION hmac(text, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.hmac(text, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.hmac(text, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.hmac(text, text, text) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) FROM postgres;
GRANT ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements(showtext boolean, OUT userid oid, OUT dbid oid, OUT toplevel boolean, OUT queryid bigint, OUT query text, OUT plans bigint, OUT total_plan_time double precision, OUT min_plan_time double precision, OUT max_plan_time double precision, OUT mean_plan_time double precision, OUT stddev_plan_time double precision, OUT calls bigint, OUT total_exec_time double precision, OUT min_exec_time double precision, OUT max_exec_time double precision, OUT mean_exec_time double precision, OUT stddev_exec_time double precision, OUT rows bigint, OUT shared_blks_hit bigint, OUT shared_blks_read bigint, OUT shared_blks_dirtied bigint, OUT shared_blks_written bigint, OUT local_blks_hit bigint, OUT local_blks_read bigint, OUT local_blks_dirtied bigint, OUT local_blks_written bigint, OUT temp_blks_read bigint, OUT temp_blks_written bigint, OUT shared_blk_read_time double precision, OUT shared_blk_write_time double precision, OUT local_blk_read_time double precision, OUT local_blk_write_time double precision, OUT temp_blk_read_time double precision, OUT temp_blk_write_time double precision, OUT wal_records bigint, OUT wal_fpi bigint, OUT wal_bytes numeric, OUT jit_functions bigint, OUT jit_generation_time double precision, OUT jit_inlining_count bigint, OUT jit_inlining_time double precision, OUT jit_optimization_count bigint, OUT jit_optimization_time double precision, OUT jit_emission_count bigint, OUT jit_emission_time double precision, OUT jit_deform_count bigint, OUT jit_deform_time double precision, OUT stats_since timestamp with time zone, OUT minmax_stats_since timestamp with time zone) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) FROM postgres;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_info(OUT dealloc bigint, OUT stats_reset timestamp with time zone) TO dashboard_user;


--
-- Name: FUNCTION pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) FROM postgres;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pg_stat_statements_reset(userid oid, dbid oid, queryid bigint, minmax_only boolean) TO dashboard_user;


--
-- Name: FUNCTION pgp_armor_headers(text, OUT key text, OUT value text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_armor_headers(text, OUT key text, OUT value text) TO dashboard_user;


--
-- Name: FUNCTION pgp_key_id(bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_key_id(bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_key_id(bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_key_id(bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt(bytea, bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt(bytea, bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_decrypt_bytea(bytea, bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_decrypt_bytea(bytea, bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt(text, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt(text, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea) TO dashboard_user;


--
-- Name: FUNCTION pgp_pub_encrypt_bytea(bytea, bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_pub_encrypt_bytea(bytea, bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt(bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_decrypt_bytea(bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_decrypt_bytea(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt(text, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt(text, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text) TO dashboard_user;


--
-- Name: FUNCTION pgp_sym_encrypt_bytea(bytea, text, text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) FROM postgres;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.pgp_sym_encrypt_bytea(bytea, text, text) TO dashboard_user;


--
-- Name: FUNCTION pgrst_ddl_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_ddl_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION pgrst_drop_watch(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.pgrst_drop_watch() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: ACL; Schema: extensions; Owner: supabase_admin
--

GRANT ALL ON FUNCTION extensions.set_graphql_placeholder() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION uuid_generate_v1(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v1() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v1mc(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v1mc() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1mc() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v1mc() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v3(namespace uuid, name text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v3(namespace uuid, name text) TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v4(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v4() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v4() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v4() TO dashboard_user;


--
-- Name: FUNCTION uuid_generate_v5(namespace uuid, name text); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_generate_v5(namespace uuid, name text) TO dashboard_user;


--
-- Name: FUNCTION uuid_nil(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_nil() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_nil() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_nil() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_dns(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_dns() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_dns() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_dns() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_oid(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_oid() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_oid() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_oid() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_url(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_url() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_url() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_url() TO dashboard_user;


--
-- Name: FUNCTION uuid_ns_x500(); Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON FUNCTION extensions.uuid_ns_x500() FROM postgres;
GRANT ALL ON FUNCTION extensions.uuid_ns_x500() TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION extensions.uuid_ns_x500() TO dashboard_user;


--
-- Name: FUNCTION graphql("operationName" text, query text, variables jsonb, extensions jsonb); Type: ACL; Schema: graphql_public; Owner: supabase_admin
--

GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO postgres;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO anon;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO authenticated;
GRANT ALL ON FUNCTION graphql_public.graphql("operationName" text, query text, variables jsonb, extensions jsonb) TO service_role;


--
-- Name: FUNCTION pg_reload_conf(); Type: ACL; Schema: pg_catalog; Owner: supabase_admin
--

GRANT ALL ON FUNCTION pg_catalog.pg_reload_conf() TO postgres WITH GRANT OPTION;


--
-- Name: FUNCTION get_auth(p_usename text); Type: ACL; Schema: pgbouncer; Owner: supabase_admin
--

REVOKE ALL ON FUNCTION pgbouncer.get_auth(p_usename text) FROM PUBLIC;
GRANT ALL ON FUNCTION pgbouncer.get_auth(p_usename text) TO pgbouncer;


--
-- Name: FUNCTION apply_rls(wal jsonb, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO anon;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO authenticated;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO service_role;
GRANT ALL ON FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer) TO supabase_realtime_admin;


--
-- Name: FUNCTION broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO postgres;
GRANT ALL ON FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text) TO dashboard_user;


--
-- Name: FUNCTION build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO postgres;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO anon;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO service_role;
GRANT ALL ON FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) TO supabase_realtime_admin;


--
-- Name: FUNCTION "cast"(val text, type_ regtype); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO postgres;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO dashboard_user;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO anon;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO authenticated;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO service_role;
GRANT ALL ON FUNCTION realtime."cast"(val text, type_ regtype) TO supabase_realtime_admin;


--
-- Name: FUNCTION check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO postgres;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO anon;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO authenticated;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO service_role;
GRANT ALL ON FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) TO supabase_realtime_admin;


--
-- Name: FUNCTION is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO postgres;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO anon;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO authenticated;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO service_role;
GRANT ALL ON FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) TO supabase_realtime_admin;


--
-- Name: FUNCTION list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO postgres;
GRANT ALL ON FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) TO dashboard_user;


--
-- Name: FUNCTION quote_wal2json(entity regclass); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO postgres;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO anon;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO authenticated;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO service_role;
GRANT ALL ON FUNCTION realtime.quote_wal2json(entity regclass) TO supabase_realtime_admin;


--
-- Name: FUNCTION send(payload jsonb, event text, topic text, private boolean); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO postgres;
GRANT ALL ON FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean) TO dashboard_user;


--
-- Name: FUNCTION subscription_check_filters(); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO postgres;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO dashboard_user;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO anon;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO authenticated;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO service_role;
GRANT ALL ON FUNCTION realtime.subscription_check_filters() TO supabase_realtime_admin;


--
-- Name: FUNCTION to_regrole(role_name text); Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO postgres;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO dashboard_user;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO anon;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO authenticated;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO service_role;
GRANT ALL ON FUNCTION realtime.to_regrole(role_name text) TO supabase_realtime_admin;


--
-- Name: FUNCTION topic(); Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON FUNCTION realtime.topic() TO postgres;
GRANT ALL ON FUNCTION realtime.topic() TO dashboard_user;


--
-- Name: FUNCTION _crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault._crypto_aead_det_decrypt(message bytea, additional bytea, key_id bigint, context bytea, nonce bytea) TO service_role;


--
-- Name: FUNCTION create_secret(new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.create_secret(new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: FUNCTION update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid); Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO postgres WITH GRANT OPTION;
GRANT ALL ON FUNCTION vault.update_secret(secret_id uuid, new_secret text, new_name text, new_description text, new_key_id uuid) TO service_role;


--
-- Name: TABLE audit_log_entries; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.audit_log_entries TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.audit_log_entries TO postgres;
GRANT SELECT ON TABLE auth.audit_log_entries TO postgres WITH GRANT OPTION;


--
-- Name: TABLE custom_oauth_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.custom_oauth_providers TO postgres;
GRANT ALL ON TABLE auth.custom_oauth_providers TO dashboard_user;


--
-- Name: TABLE flow_state; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.flow_state TO postgres;
GRANT SELECT ON TABLE auth.flow_state TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.flow_state TO dashboard_user;


--
-- Name: TABLE identities; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.identities TO postgres;
GRANT SELECT ON TABLE auth.identities TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.identities TO dashboard_user;


--
-- Name: TABLE instances; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.instances TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.instances TO postgres;
GRANT SELECT ON TABLE auth.instances TO postgres WITH GRANT OPTION;


--
-- Name: TABLE mfa_amr_claims; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_amr_claims TO postgres;
GRANT SELECT ON TABLE auth.mfa_amr_claims TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_amr_claims TO dashboard_user;


--
-- Name: TABLE mfa_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_challenges TO postgres;
GRANT SELECT ON TABLE auth.mfa_challenges TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_challenges TO dashboard_user;


--
-- Name: TABLE mfa_factors; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.mfa_factors TO postgres;
GRANT SELECT ON TABLE auth.mfa_factors TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.mfa_factors TO dashboard_user;


--
-- Name: TABLE oauth_authorizations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_authorizations TO postgres;
GRANT ALL ON TABLE auth.oauth_authorizations TO dashboard_user;


--
-- Name: TABLE oauth_client_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_client_states TO postgres;
GRANT ALL ON TABLE auth.oauth_client_states TO dashboard_user;


--
-- Name: TABLE oauth_clients; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_clients TO postgres;
GRANT ALL ON TABLE auth.oauth_clients TO dashboard_user;


--
-- Name: TABLE oauth_consents; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.oauth_consents TO postgres;
GRANT ALL ON TABLE auth.oauth_consents TO dashboard_user;


--
-- Name: TABLE one_time_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.one_time_tokens TO postgres;
GRANT SELECT ON TABLE auth.one_time_tokens TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.one_time_tokens TO dashboard_user;


--
-- Name: TABLE refresh_tokens; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.refresh_tokens TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.refresh_tokens TO postgres;
GRANT SELECT ON TABLE auth.refresh_tokens TO postgres WITH GRANT OPTION;


--
-- Name: SEQUENCE refresh_tokens_id_seq; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO dashboard_user;
GRANT ALL ON SEQUENCE auth.refresh_tokens_id_seq TO postgres;


--
-- Name: TABLE saml_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_providers TO postgres;
GRANT SELECT ON TABLE auth.saml_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_providers TO dashboard_user;


--
-- Name: TABLE saml_relay_states; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.saml_relay_states TO postgres;
GRANT SELECT ON TABLE auth.saml_relay_states TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.saml_relay_states TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT SELECT ON TABLE auth.schema_migrations TO postgres WITH GRANT OPTION;


--
-- Name: TABLE sessions; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sessions TO postgres;
GRANT SELECT ON TABLE auth.sessions TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sessions TO dashboard_user;


--
-- Name: TABLE sso_domains; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_domains TO postgres;
GRANT SELECT ON TABLE auth.sso_domains TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_domains TO dashboard_user;


--
-- Name: TABLE sso_providers; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.sso_providers TO postgres;
GRANT SELECT ON TABLE auth.sso_providers TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE auth.sso_providers TO dashboard_user;


--
-- Name: TABLE users; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.users TO dashboard_user;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE auth.users TO postgres;
GRANT SELECT ON TABLE auth.users TO postgres WITH GRANT OPTION;


--
-- Name: TABLE webauthn_challenges; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.webauthn_challenges TO postgres;
GRANT ALL ON TABLE auth.webauthn_challenges TO dashboard_user;


--
-- Name: TABLE webauthn_credentials; Type: ACL; Schema: auth; Owner: supabase_auth_admin
--

GRANT ALL ON TABLE auth.webauthn_credentials TO postgres;
GRANT ALL ON TABLE auth.webauthn_credentials TO dashboard_user;


--
-- Name: TABLE pg_stat_statements; Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON TABLE extensions.pg_stat_statements FROM postgres;
GRANT ALL ON TABLE extensions.pg_stat_statements TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE extensions.pg_stat_statements TO dashboard_user;


--
-- Name: TABLE pg_stat_statements_info; Type: ACL; Schema: extensions; Owner: postgres
--

REVOKE ALL ON TABLE extensions.pg_stat_statements_info FROM postgres;
GRANT ALL ON TABLE extensions.pg_stat_statements_info TO postgres WITH GRANT OPTION;
GRANT ALL ON TABLE extensions.pg_stat_statements_info TO dashboard_user;


--
-- Name: TABLE messages; Type: ACL; Schema: realtime; Owner: supabase_realtime_admin
--

GRANT ALL ON TABLE realtime.messages TO postgres;
GRANT ALL ON TABLE realtime.messages TO dashboard_user;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO anon;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE realtime.messages TO service_role;


--
-- Name: TABLE messages_2026_05_05; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_05_05 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_05_05 TO dashboard_user;


--
-- Name: TABLE messages_2026_05_06; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_05_06 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_05_06 TO dashboard_user;


--
-- Name: TABLE messages_2026_05_07; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_05_07 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_05_07 TO dashboard_user;


--
-- Name: TABLE messages_2026_05_08; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_05_08 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_05_08 TO dashboard_user;


--
-- Name: TABLE messages_2026_05_09; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_05_09 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_05_09 TO dashboard_user;


--
-- Name: TABLE messages_2026_05_10; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_05_10 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_05_10 TO dashboard_user;


--
-- Name: TABLE messages_2026_05_11; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.messages_2026_05_11 TO postgres;
GRANT ALL ON TABLE realtime.messages_2026_05_11 TO dashboard_user;


--
-- Name: TABLE schema_migrations; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.schema_migrations TO postgres;
GRANT ALL ON TABLE realtime.schema_migrations TO dashboard_user;
GRANT SELECT ON TABLE realtime.schema_migrations TO anon;
GRANT SELECT ON TABLE realtime.schema_migrations TO authenticated;
GRANT SELECT ON TABLE realtime.schema_migrations TO service_role;
GRANT ALL ON TABLE realtime.schema_migrations TO supabase_realtime_admin;


--
-- Name: TABLE subscription; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON TABLE realtime.subscription TO postgres;
GRANT ALL ON TABLE realtime.subscription TO dashboard_user;
GRANT SELECT ON TABLE realtime.subscription TO anon;
GRANT SELECT ON TABLE realtime.subscription TO authenticated;
GRANT SELECT ON TABLE realtime.subscription TO service_role;
GRANT ALL ON TABLE realtime.subscription TO supabase_realtime_admin;


--
-- Name: SEQUENCE subscription_id_seq; Type: ACL; Schema: realtime; Owner: supabase_admin
--

GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO postgres;
GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO dashboard_user;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO anon;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO authenticated;
GRANT USAGE ON SEQUENCE realtime.subscription_id_seq TO service_role;
GRANT ALL ON SEQUENCE realtime.subscription_id_seq TO supabase_realtime_admin;


--
-- Name: TABLE buckets; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

REVOKE ALL ON TABLE storage.buckets FROM supabase_storage_admin;
GRANT ALL ON TABLE storage.buckets TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON TABLE storage.buckets TO service_role;
GRANT ALL ON TABLE storage.buckets TO authenticated;
GRANT ALL ON TABLE storage.buckets TO anon;
GRANT ALL ON TABLE storage.buckets TO postgres WITH GRANT OPTION;


--
-- Name: TABLE buckets_analytics; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.buckets_analytics TO service_role;
GRANT ALL ON TABLE storage.buckets_analytics TO authenticated;
GRANT ALL ON TABLE storage.buckets_analytics TO anon;


--
-- Name: TABLE buckets_vectors; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.buckets_vectors TO service_role;
GRANT SELECT ON TABLE storage.buckets_vectors TO authenticated;
GRANT SELECT ON TABLE storage.buckets_vectors TO anon;


--
-- Name: TABLE objects; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

REVOKE ALL ON TABLE storage.objects FROM supabase_storage_admin;
GRANT ALL ON TABLE storage.objects TO supabase_storage_admin WITH GRANT OPTION;
GRANT ALL ON TABLE storage.objects TO service_role;
GRANT ALL ON TABLE storage.objects TO authenticated;
GRANT ALL ON TABLE storage.objects TO anon;
GRANT ALL ON TABLE storage.objects TO postgres WITH GRANT OPTION;


--
-- Name: TABLE s3_multipart_uploads; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads TO anon;


--
-- Name: TABLE s3_multipart_uploads_parts; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT ALL ON TABLE storage.s3_multipart_uploads_parts TO service_role;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO authenticated;
GRANT SELECT ON TABLE storage.s3_multipart_uploads_parts TO anon;


--
-- Name: TABLE vector_indexes; Type: ACL; Schema: storage; Owner: supabase_storage_admin
--

GRANT SELECT ON TABLE storage.vector_indexes TO service_role;
GRANT SELECT ON TABLE storage.vector_indexes TO authenticated;
GRANT SELECT ON TABLE storage.vector_indexes TO anon;


--
-- Name: TABLE secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.secrets TO service_role;


--
-- Name: TABLE decrypted_secrets; Type: ACL; Schema: vault; Owner: supabase_admin
--

GRANT SELECT,REFERENCES,DELETE,TRUNCATE ON TABLE vault.decrypted_secrets TO postgres WITH GRANT OPTION;
GRANT SELECT,DELETE ON TABLE vault.decrypted_secrets TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: auth; Owner: supabase_auth_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_auth_admin IN SCHEMA auth GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON SEQUENCES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON FUNCTIONS TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: extensions; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA extensions GRANT ALL ON TABLES TO postgres WITH GRANT OPTION;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: graphql_public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA graphql_public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON SEQUENCES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON FUNCTIONS TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: realtime; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA realtime GRANT ALL ON TABLES TO dashboard_user;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: storage; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA storage GRANT ALL ON TABLES TO service_role;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


ALTER EVENT TRIGGER issue_graphql_placeholder OWNER TO supabase_admin;

--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


ALTER EVENT TRIGGER issue_pg_cron_access OWNER TO supabase_admin;

--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE FUNCTION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


ALTER EVENT TRIGGER issue_pg_graphql_access OWNER TO supabase_admin;

--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


ALTER EVENT TRIGGER issue_pg_net_access OWNER TO supabase_admin;

--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


ALTER EVENT TRIGGER pgrst_ddl_watch OWNER TO supabase_admin;

--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: supabase_admin
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


ALTER EVENT TRIGGER pgrst_drop_watch OWNER TO supabase_admin;

--
-- PostgreSQL database dump complete
--

\unrestrict Q3OanUTCbpdjek2Av6YnfGFtV8BjFU8ethjgoWqrZN1tn6uPrpMh5hdqYHunahB

