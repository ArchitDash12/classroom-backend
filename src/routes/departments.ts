import { and, desc, eq, getTableColumns, ilike, or, sql, asc } from "drizzle-orm";
import express from "express";
import { db } from "../db/index.js";
import { departments, subjects, classes } from "../db/schema/index.js";

const router = express.Router();

// GET /api/departments
router.get("/", async (req, res) => {
  try {
    const { search, page = 1, limit = 10, _sort = "createdAt", _order = "desc" } = req.query;

    const currentPage = Math.max(1, parseInt(String(page), 10) || 1);
    const limitPerPage = Math.min(
      Math.max(1, parseInt(String(limit), 10) || 10),
      100
    );
    const offset = (currentPage - 1) * limitPerPage;

    const filterConditions = [];
    if (search) {
      filterConditions.push(
        or(
          ilike(departments.name, `%${search}%`),
          ilike(departments.code, `%${search}%`)
        )
      );
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(departments)
      .where(whereClause);

    const totalCount = Number(countResult[0]?.count ?? 0);

    const sortOrder = String(_order).toLowerCase() === "asc" ? asc : desc;
    const sortField =
      String(_sort) === "name"
        ? departments.name
        : String(_sort) === "code"
        ? departments.code
        : departments.createdAt;

    // Get departments with subject count
    const departmentsList = await db
      .select({
        ...getTableColumns(departments),
        subjectCount: sql<number>`cast(count(distinct ${subjects.id}) as integer)`,
        classCount: sql<number>`cast(count(distinct ${classes.id}) as integer)`,
      })
      .from(departments)
      .leftJoin(subjects, eq(departments.id, subjects.departmentId))
      .leftJoin(classes, eq(subjects.id, classes.subjectId))
      .where(whereClause)
      .groupBy(departments.id)
      .orderBy(sortOrder(sortField))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: departmentsList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (e: any) {
    console.error(`GET /departments error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get departments" });
  }
});

// GET /api/departments/:id
router.get("/:id", async (req, res) => {
  try {
    const deptId = Number(req.params.id);
    if (!Number.isFinite(deptId)) {
      return res.status(400).json({ error: "Invalid department ID" });
    }

    const [dept] = await db
      .select({
        ...getTableColumns(departments),
        subjectCount: sql<number>`cast(count(distinct ${subjects.id}) as integer)`,
        classCount: sql<number>`cast(count(distinct ${classes.id}) as integer)`,
      })
      .from(departments)
      .leftJoin(subjects, eq(departments.id, subjects.departmentId))
      .leftJoin(classes, eq(subjects.id, classes.subjectId))
      .where(eq(departments.id, deptId))
      .groupBy(departments.id);

    if (!dept) {
      return res.status(404).json({ error: "Department not found" });
    }

    // Also fetch associated subjects
    const deptSubjects = await db
      .select({
        ...getTableColumns(subjects),
      })
      .from(subjects)
      .where(eq(subjects.departmentId, deptId));

    res.status(200).json({
      data: {
        ...dept,
        subjects: deptSubjects,
      },
    });
  } catch (e: any) {
    console.error(`GET /departments/:id error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get department details" });
  }
});

// POST /api/departments
router.post("/", async (req, res) => {
  try {
    const { code, name, description } = req.body;

    if (!code || !name) {
      return res.status(400).json({ error: "Department code and name are required" });
    }

    // Check code uniqueness
    const existing = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.code, String(code).trim().toUpperCase()));

    if (existing.length > 0) {
      return res.status(400).json({ error: `Department code '${code}' already exists` });
    }

    const [created] = await db
      .insert(departments)
      .values({
        code: String(code).trim().toUpperCase(),
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
      })
      .returning();

    res.status(201).json({ data: created });
  } catch (e: any) {
    console.error(`POST /departments error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to create department" });
  }
});

// PUT /api/departments/:id
router.put("/:id", async (req, res) => {
  try {
    const deptId = Number(req.params.id);
    if (!Number.isFinite(deptId)) {
      return res.status(400).json({ error: "Invalid department ID" });
    }

    const { code, name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Department name is required" });
    }

    if (code) {
      const existing = await db
        .select({ id: departments.id })
        .from(departments)
        .where(
          and(
            eq(departments.code, String(code).trim().toUpperCase()),
            sql`${departments.id} != ${deptId}`
          )
        );
      if (existing.length > 0) {
        return res.status(400).json({ error: `Department code '${code}' already exists` });
      }
    }

    const [updated] = await db
      .update(departments)
      .set({
        ...(code ? { code: String(code).trim().toUpperCase() } : {}),
        name: String(name).trim(),
        description: description !== undefined ? String(description).trim() : undefined,
      })
      .where(eq(departments.id, deptId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Department not found" });
    }

    res.status(200).json({ data: updated });
  } catch (e: any) {
    console.error(`PUT /departments/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to update department" });
  }
});

// DELETE /api/departments/:id
router.delete("/:id", async (req, res) => {
  try {
    const deptId = Number(req.params.id);
    if (!Number.isFinite(deptId)) {
      return res.status(400).json({ error: "Invalid department ID" });
    }

    // Constraint Check: Check if department has subjects
    const linkedSubjects = await db
      .select({ id: subjects.id, name: subjects.name })
      .from(subjects)
      .where(eq(subjects.departmentId, deptId));

    if (linkedSubjects.length > 0) {
      return res.status(400).json({
        error: `Cannot delete department. There are ${linkedSubjects.length} subject(s) currently linked to this department (${linkedSubjects.map((s) => s.name).slice(0, 3).join(", ")}${linkedSubjects.length > 3 ? "..." : ""}). Please reassign or remove them first.`,
      });
    }

    const [deleted] = await db
      .delete(departments)
      .where(eq(departments.id, deptId))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Department not found" });
    }

    res.status(200).json({ data: deleted, message: "Department deleted successfully" });
  } catch (e: any) {
    console.error(`DELETE /departments/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to delete department" });
  }
});

export default router;

