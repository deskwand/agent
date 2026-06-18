---
name: sql-query
description: "Generate, explain, and optimize SQL queries. Use when user asks to write SQL, optimize a query, or explain what a query does."
version: 1.0.0
author: omagt
license: MIT
metadata:
  tags: [SQL, Database, Queries, MySQL, PostgreSQL, SQLite]
allowed-tools: "read,shell"
---

# SQL Query Tools

Write, review, and optimize SQL queries.

## When to use

- User asks to "write a SQL query to..."
- User has an existing query and wants optimization
- User needs to explain or debug a SQL query
- User wants to design a schema or add indexes

---

## Query Generation Guidelines

### 1. Always ask for schema context first

Before writing a query, identify:
- **Database engine**: PostgreSQL, MySQL, SQLite, etc.
- **Table structure**: columns, types, relationships
- **Data volume**: approximate row counts

### 2. Write safe queries

```sql
-- ✅ Parameterized
SELECT * FROM users WHERE id = ?;

-- ❌ String interpolation (SQL injection risk)
SELECT * FROM users WHERE id = '${userId}';
```

### 3. Include EXPLAIN for performance

```sql
EXPLAIN ANALYZE SELECT ...
```

### 4. Common patterns

```sql
-- Join with aggregation
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name
HAVING COUNT(o.id) > 5
ORDER BY order_count DESC;

-- Window functions
SELECT
  department,
  employee,
  salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) as rank
FROM employees;

-- CTE (Common Table Expression)
WITH monthly_sales AS (
  SELECT DATE_TRUNC('month', created_at) as month, SUM(amount) as total
  FROM orders
  GROUP BY 1
)
SELECT month, total, LAG(total) OVER (ORDER BY month) as prev_month
FROM monthly_sales;

-- Upsert (PostgreSQL)
INSERT INTO users (id, email, name)
VALUES (1, 'a@b.com', 'Alice')
ON CONFLICT (id) DO UPDATE
SET email = EXCLUDED.email, name = EXCLUDED.name;
```

---

## Query Review Checklist

When reviewing an existing query:

1. **Correctness**: Does it return the expected results? Check JOIN conditions, WHERE filters, NULL handling.
2. **Performance**: Are there missing indexes? Can subqueries be rewritten as JOINs? Is LIMIT used where appropriate?
3. **Safety**: No SQL injection vectors. No `SELECT *` in production code.
4. **Readability**: Proper formatting, meaningful aliases, comments for complex logic.

## Engine-Specific Notes

| Feature | PostgreSQL | MySQL | SQLite |
|---------|-----------|-------|--------|
| String concat | `\|\|` | `CONCAT()` | `\|\|` |
| Limit + offset | `LIMIT n OFFSET m` | `LIMIT m, n` | `LIMIT n OFFSET m` |
| Current timestamp | `NOW()` | `NOW()` | `datetime('now')` |
| Boolean type | `BOOLEAN` | `TINYINT(1)` | `INTEGER` (0/1) |
| JSON support | `JSONB` | `JSON` | `TEXT` + json functions |

## Constraints

- Never execute DROP, TRUNCATE, or DELETE without explicit user confirmation
- Always show estimated row impact before UPDATE/DELETE
- Generate queries with parameterized placeholders, not literal values
