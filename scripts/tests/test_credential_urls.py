import runpy
from pathlib import Path
import unittest

check = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'check-credential-urls.py'))['findings']

class CredentialUrlTest(unittest.TestCase):
    def url(self, password):
        return 'postgresql://' + 'test_user:' + password + '@localhost/example_database'

    def test_actual_literals_are_flagged_without_returning_values(self):
        for value in ['synthetic-test-literal', 'password', 'encoded%2Dtest%2Dliteral']:
            self.assertEqual(check(self.url(value)), [1])

    def test_explicit_templates_and_environment_references_are_distinct(self):
        for value in ['YOUR_DEV_PASSWORD', 'your_password', 'EXAMPLE_PASSWORD', '${DATABASE_PASSWORD}', '${env:DATABASE_PASSWORD}']:
            self.assertEqual(check(self.url(value)), [])

    def test_mixed_lines_cannot_hide_a_real_literal_behind_a_template(self):
        self.assertEqual(check(self.url('YOUR_PASSWORD')+'\n'+self.url('synthetic-test-literal')), [2])

if __name__ == '__main__':
    unittest.main()
