import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { sanitizeFts5Query, buildFtsQuery } from '../fts-query.js';

describe('sanitizeFts5Query', () => {
  describe('empty and whitespace inputs', () => {
    it('returns null for empty string', () => {
      expect(sanitizeFts5Query('')).toBeNull();
    });

    it('returns null for whitespace-only strings', () => {
      expect(sanitizeFts5Query('   ')).toBeNull();
      expect(sanitizeFts5Query('\t\n\r  ')).toBeNull();
    });

    it('returns null for non-string or falsy inputs', () => {
      expect(sanitizeFts5Query(null as unknown as string)).toBeNull();
      expect(sanitizeFts5Query(undefined as unknown as string)).toBeNull();
    });
  });

  describe('punctuation-only queries', () => {
    it('returns null for various punctuation strings without alphanumeric characters', () => {
      expect(sanitizeFts5Query('!@#$%^&*()')).toBeNull();
      expect(sanitizeFts5Query('... --- ???')).toBeNull();
      expect(sanitizeFts5Query(':::')).toBeNull();
      expect(sanitizeFts5Query(';;;')).toBeNull();
      expect(sanitizeFts5Query('===')).toBeNull();
      expect(sanitizeFts5Query('<<<>>>')).toBeNull();
      expect(sanitizeFts5Query('___')).toBeNull();
      expect(sanitizeFts5Query('()[]{}')).toBeNull();
      expect(sanitizeFts5Query('"\'`')).toBeNull();
    });
  });

  describe('quote handling', () => {
    it('handles double quotes safely as separators and quotes tokens', () => {
      expect(sanitizeFts5Query('say "hello world"')).toBe('"say" OR "hello" OR "world"');
    });

    it('handles unbalanced and lone quotes without crashing', () => {
      expect(sanitizeFts5Query('"unclosed')).toBe('"unclosed"');
      expect(sanitizeFts5Query('"""""')).toBeNull();
      expect(sanitizeFts5Query('"foo" "bar"')).toBe('"foo" OR "bar"');
    });

    it('handles single quotes and apostrophes', () => {
      expect(sanitizeFts5Query("user's token")).toBe('"user" OR "s" OR "token"');
      expect(sanitizeFts5Query("'''")).toBeNull();
    });
  });

  describe('brackets, braces, and parentheses', () => {
    it('strips parentheses and treats enclosed words as tokens', () => {
      expect(sanitizeFts5Query('(postgres)')).toBe('"postgres"');
      expect(sanitizeFts5Query('((nested) groups)')).toBe('"nested" OR "groups"');
    });

    it('strips square brackets', () => {
      expect(sanitizeFts5Query('[bracketed] term')).toBe('"bracketed" OR "term"');
      expect(sanitizeFts5Query('array[0]')).toBe('"array" OR "0"');
    });

    it('strips curly braces', () => {
      expect(sanitizeFts5Query('{postgres} proxy')).toBe('"postgres" OR "proxy"');
      expect(sanitizeFts5Query('{key: "value"}')).toBe('"key" OR "value"');
    });
  });

  describe('hyphens and colons', () => {
    it('handles hyphens as separators', () => {
      expect(sanitizeFts5Query('postgres - 5433')).toBe('"postgres" OR "5433"');
      expect(sanitizeFts5Query('cross-platform-build')).toBe('"cross" OR "platform" OR "build"');
      expect(sanitizeFts5Query('-forbidden')).toBe('"forbidden"');
    });

    it('handles colons safely without triggering column-filter syntax', () => {
      expect(sanitizeFts5Query('port:5433')).toBe('"port" OR "5433"');
      expect(sanitizeFts5Query('std::vector::iterator')).toBe('"std" OR "vector" OR "iterator"');
      expect(sanitizeFts5Query('http://localhost:8080/api')).toBe('"http" OR "localhost" OR "8080" OR "api"');
    });
  });

  describe('asterisks and special symbols', () => {
    it('handles trailing or leading asterisks', () => {
      expect(sanitizeFts5Query('postgres*')).toBe('"postgres"');
      expect(sanitizeFts5Query('*wildcard*')).toBe('"wildcard"');
      expect(sanitizeFts5Query('*')).toBeNull();
      expect(sanitizeFts5Query('***')).toBeNull();
    });

    it('handles carets, slashes, and math symbols', () => {
      expect(sanitizeFts5Query('^proxy')).toBe('"proxy"');
      expect(sanitizeFts5Query('path/to/file.ts')).toBe('"path" OR "to" OR "file" OR "ts"');
      expect(sanitizeFts5Query('a + b = c < d > e')).toBe('"a" OR "b" OR "c" OR "d" OR "e"');
      expect(sanitizeFts5Query('foo & bar | baz ~ qux')).toBe('"foo" OR "bar" OR "baz" OR "qux"');
    });
  });

  describe('SQL operators and FTS keywords', () => {
    it('quotes FTS boolean operators as literal phrases', () => {
      expect(sanitizeFts5Query('AND')).toBe('"AND"');
      expect(sanitizeFts5Query('OR')).toBe('"OR"');
      expect(sanitizeFts5Query('NOT')).toBe('"NOT"');
      expect(sanitizeFts5Query('NEAR')).toBe('"NEAR"');
    });

    it('handles dangling boolean operators safely', () => {
      expect(sanitizeFts5Query('hello AND')).toBe('"hello" OR "AND"');
      expect(sanitizeFts5Query('OR world')).toBe('"OR" OR "world"');
      expect(sanitizeFts5Query('foo NOT bar')).toBe('"foo" OR "NOT" OR "bar"');
    });

    it('handles SQL statements and injection attempts', () => {
      expect(sanitizeFts5Query('SELECT * FROM memory WHERE 1=1;')).toBe(
        '"SELECT" OR "FROM" OR "memory" OR "WHERE" OR "1" OR "1"'
      );
      expect(sanitizeFts5Query("DROP TABLE memory_entries; --")).toBe(
        '"DROP" OR "TABLE" OR "memory_entries"'
      );
    });
  });

  describe('Unicode and multilingual support', () => {
    it('preserves CJK ideographs', () => {
      expect(sanitizeFts5Query('金银价格')).toBe('"金银价格"');
      expect(sanitizeFts5Query('中文 搜索 引擎')).toBe('"中文" OR "搜索" OR "引擎"');
    });

    it('handles Japanese scripts (kanji, hiragana, katakana)', () => {
      expect(sanitizeFts5Query('価格 2026年 テスト')).toBe('"価格" OR "2026年" OR "テスト"');
    });

    it('handles accented Latin letters', () => {
      expect(sanitizeFts5Query('café résumé naïve')).toBe('"café" OR "résumé" OR "naïve"');
    });
  });

  describe('identifiers and underscores', () => {
    it('preserves underscores inside identifiers', () => {
      expect(sanitizeFts5Query('user_id')).toBe('"user_id"');
      expect(sanitizeFts5Query('FOO_bar baz_1')).toBe('"FOO_bar" OR "baz_1"');
      expect(sanitizeFts5Query('__init__')).toBe('"__init__"');
    });
  });

  describe('alias compatibility', () => {
    it('buildFtsQuery is an exact alias of sanitizeFts5Query', () => {
      expect(buildFtsQuery).toBe(sanitizeFts5Query);
      expect(buildFtsQuery('hello world')).toBe('"hello" OR "world"');
    });
  });

  describe('Live SQLite FTS5 table execution', () => {
    let db: Database.Database;

    beforeEach(() => {
      db = new Database(':memory:');
      db.exec(`
        CREATE VIRTUAL TABLE fts_test USING fts5(content);
        INSERT INTO fts_test(content) VALUES
          ('Postgres runs on port 5433 behind the proxy'),
          ('TypeScript and SQLite persistent memory store'),
          ('user_id token auth flow with café résumé'),
          ('CJK sample: 金银价格 2026年 搜索引擎');
      `);
    });

    afterEach(() => {
      db.close();
    });

    const testQueries = [
      'postgres "port" - 5433',
      '(postgres)',
      'port:5433',
      'postgres*',
      '^proxy',
      '{postgres} proxy',
      '[bracketed] token',
      'foo OR bar AND baz NOT qux NEAR test',
      'SELECT * FROM fts_test WHERE 1=1',
      'DROP TABLE fts_test; --',
      'col:val',
      'path/to/file.ts',
      'user_id',
      'café résumé',
      '金银价格',
      '2026年',
      'foo & bar | baz ~ qux',
      'a + b = c < d > e',
      'say "hello world"',
      'unbalanced "quotes',
      '!@#$%^&*()',
      '   ',
      '',
    ];

    for (const q of testQueries) {
      it(`does not crash SQLite FTS5 MATCH for query: ${JSON.stringify(q)}`, () => {
        const sanitized = sanitizeFts5Query(q);
        if (sanitized === null) {
          expect(sanitized).toBeNull();
        } else {
          expect(() => {
            const stmt = db.prepare('SELECT * FROM fts_test WHERE fts_test MATCH ?');
            stmt.all(sanitized);
          }).not.toThrow();
        }
      });
    }

    it('matches expected rows using sanitized queries', () => {
      const q = sanitizeFts5Query('postgres:5433 (proxy)');
      expect(q).not.toBeNull();
      const rows = db.prepare('SELECT * FROM fts_test WHERE fts_test MATCH ?').all(q!);
      expect(rows.length).toBe(1);
    });

    it('matches CJK and accented words correctly', () => {
      const q1 = sanitizeFts5Query('金银价格');
      expect(q1).not.toBeNull();
      const r1 = db.prepare('SELECT * FROM fts_test WHERE fts_test MATCH ?').all(q1!);
      expect(r1.length).toBe(1);

      const q2 = sanitizeFts5Query('café');
      expect(q2).not.toBeNull();
      const r2 = db.prepare('SELECT * FROM fts_test WHERE fts_test MATCH ?').all(q2!);
      expect(r2.length).toBe(1);
    });
  });
});
