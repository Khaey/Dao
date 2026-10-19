"""Offline scope classification tests: any ambiguity must run FULL E2E."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "ci-fast-path.py"
spec = importlib.util.spec_from_file_location("ci_fast_path", path)
fast = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fast)

PATH = "dao-backend/supabase/migrations/20261019210000_oce_drop_unused_mark_synced.sql"
CONTRACT = fast.CONTRACT
SQL = """-- stale OCE function only
begin;
drop function if exists public.oce_mark_synced(uuid);
drop function if exists dao_private.oce_mark_synced(uuid);
commit;
"""
OLD = """DO $$
BEGIN
  versions := ARRAY['20261019200000','20261019140000'];
  IF existing_policy IS FALSE THEN
    RAISE EXCEPTION 'existing check';
  END IF;
END $$;
"""
NEW = OLD.replace("'20261019200000'", "'20261019200000','20261019210000'").replace(
    "END $$;",
    """  IF to_regprocedure('public.oce_mark_synced(uuid)') IS NOT NULL OR to_regprocedure('dao_private.oce_mark_synced(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'obsolete overload must be removed';
  END IF;
END $$;""",
)


class FastPathTests(unittest.TestCase):
    def classify(self, sql=SQL, new=NEW, paths=None):
        return fast.classify_diff(
            paths or [("A", PATH), ("M", CONTRACT)],
            OLD, new, {PATH: sql},
        )

    def test_approved_minimal_migration(self):
        self.assertEqual(self.classify(), "sql_cleanup")

    def test_any_other_file_or_modified_migration_requires_full(self):
        self.assertEqual(self.classify(paths=[("A", PATH), ("M", CONTRACT), ("M", "dao-frontend/app/page.tsx")]), "full")
        self.assertEqual(self.classify(paths=[("M", PATH), ("M", CONTRACT)]), "full")
        self.assertEqual(self.classify(paths=[("A", PATH), ("M", CONTRACT), ("M", "AGENTS.md")]), "full")

    def test_sql_can_only_drop_named_oce_functions(self):
        for bad in (
            "begin;\ndrop table public.projects;\ncommit;",
            "begin;\ndrop function public.oce_mark_synced(uuid) cascade;\ncommit;",
            "begin;\ndrop function if exists auth.uid();\ncommit;",
            "begin;\ncreate or replace function public.oce_new() returns void language sql as $$ select 1 $$;\ncommit;",
            "begin;\ndrop function if exists public.oce_mark_synced(uuid);\ngrant all on schema public to authenticated;\ncommit;",
        ):
            with self.subTest(sql=bad):
                self.assertEqual(self.classify(sql=bad), "full")

    def test_schema_must_keep_existing_assertions(self):
        self.assertEqual(self.classify(new=NEW.replace("RAISE EXCEPTION 'existing check';", "")), "full")
        self.assertEqual(self.classify(new=NEW.replace("20261019210000", "20261019210001")), "full")
        self.assertEqual(self.classify(new=NEW.replace("dao_private.oce_mark_synced(uuid)", "dao_private.oce_other(uuid)")), "full")
        self.assertEqual(self.classify(new=NEW.replace("END IF;\nEND $$;", "END IF;\nDROP TABLE public.projects;\nEND $$;")), "full")

    def test_schema_empty_and_without_new_assertions_requires_full(self):
        self.assertEqual(self.classify(new=OLD), "full")
        self.assertEqual(self.classify(new=NEW.replace("RAISE EXCEPTION 'obsolete overload must be removed';", "")), "full")

    def test_invalid_checkout_context_is_full(self):
        self.assertEqual(fast.classify_repo("", ""), "full")
        self.assertEqual(fast.classify_repo("not sha", "abc"), "full")


if __name__ == "__main__":
    unittest.main()
