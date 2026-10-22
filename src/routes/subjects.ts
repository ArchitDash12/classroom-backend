import { and, desc, eq, getTableColumns, ilike, or, sql, asc } from "drizzle-orm";
import express from "express";
import { departments, subjects, classes } from "../db/schema/index.js";
import { db } from "../db/index.js";

const router = express.Router();

// GET /api/subjects
router.get("/", async (req, res) => {
  try {
    const { search, department, page = 1, limit = 10, _sort = "createdAt", _order = "desc" } = req.query;

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
          ilike(subjects.name, `%${search}%`),
          ilike(subjects.code, `%${search}%`)
        )
      );
    }

    if (department && department !== "all") {
      const deptNum = Number(department);
      if (Number.isFinite(deptNum)) {
        filterConditions.push(eq(subjects.departmentId, deptNum));
      } else {
        const deptPattern = `%${String(department).replace(/[%_]/g, "\\$&")}%`;
        filterConditions.push(ilike(departments.name, deptPattern));
      }
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(distinct ${subjects.id})` })
      .from(subjects)
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .where(whereClause);

    const totalCount = Number(countResult[0]?.count ?? 0);

    const sortOrder = String(_order).toLowerCase() === "asc" ? asc : desc;
    const sortField =
      String(_sort) === "name"
        ? subjects.name
        : String(_sort) === "code"
        ? subjects.code
        : subjects.createdAt;

    const subjectsList = await db
      .select({
        ...getTableColumns(subjects),
        department: { ...getTableColumns(departments) },
        classCount: sql<number>`cast(count(distinct ${classes.id}) as integer)`,
      })
      .from(subjects)
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .leftJoin(classes, eq(subjects.id, classes.subjectId))
      .where(whereClause)
      .groupBy(subjects.id, departments.id)
      .orderBy(sortOrder(sortField))
      .limit(limitPerPage)
      .offset(offset);

    res.status(200).json({
      data: subjectsList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (e: any) {
    console.error(`GET /subjects error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get subjects" });
  }
});

// GET /api/subjects/:id
router.get("/:id", async (req, res) => {
  try {
    const subjectId = Number(req.params.id);
    if (!Number.isFinite(subjectId)) {
      return res.status(400).json({ error: "Invalid subject ID" });
    }

    const [subject] = await db
      .select({
        ...getTableColumns(subjects),
        department: { ...getTableColumns(departments) },
        classCount: sql<number>`cast(count(distinct ${classes.id}) as integer)`,
      })
      .from(subjects)
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .leftJoin(classes, eq(subjects.id, classes.subjectId))
      .where(eq(subjects.id, subjectId))
      .groupBy(subjects.id, departments.id);

    if (!subject) {
      return res.status(404).json({ error: "Subject not found" });
    }

    const subjectClasses = await db
      .select({
        ...getTableColumns(classes),
      })
      .from(classes)
      .where(eq(classes.subjectId, subjectId));

    res.status(200).json({
      data: {
        ...subject,
        classes: subjectClasses,
      },
    });
  } catch (e: any) {
    console.error(`GET /subjects/:id error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get subject details" });
  }
});

// POST /api/subjects
router.post("/", async (req, res) => {
  try {
    const { name, code, departmentId, description } = req.body;

    if (!name || !code || !departmentId) {
      return res.status(400).json({
        error: "Subject name, code, and departmentId are required",
      });
    }

    const deptIdNum = Number(departmentId);
    if (!Number.isFinite(deptIdNum)) {
      return res.status(400).json({ error: "Invalid department ID" });
    }

    // Verify department exists
    const [dept] = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, deptIdNum));

    if (!dept) {
      return res.status(400).json({ error: "Specified department does not exist" });
    }

    // Check code uniqueness
    const existing = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.code, String(code).trim().toUpperCase()));

    if (existing.length > 0) {
      return res.status(400).json({ error: `Subject code '${code}' already exists` });
    }

    const [created] = await db
      .insert(subjects)
      .values({
        name: String(name).trim(),
        code: String(code).trim().toUpperCase(),
        departmentId: deptIdNum,
        description: description ? String(description).trim() : null,
      })
      .returning();

    res.status(201).json({ data: created });
  } catch (e: any) {
    console.error(`POST /subjects error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to create subject" });
  }
});

// PUT /api/subjects/:id
router.put("/:id", async (req, res) => {
  try {
    const subjectId = Number(req.params.id);
    if (!Number.isFinite(subjectId)) {
      return res.status(400).json({ error: "Invalid subject ID" });
    }

    const { name, code, departmentId, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Subject name is required" });
    }

    if (code) {
      const existing = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(
          and(
            eq(subjects.code, String(code).trim().toUpperCase()),
            sql`${subjects.id} != ${subjectId}`
          )
        );
      if (existing.length > 0) {
        return res.status(400).json({ error: `Subject code '${code}' already exists` });
      }
    }

    if (departmentId) {
      const deptIdNum = Number(departmentId);
      const [dept] = await db
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.id, deptIdNum));
      if (!dept) {
        return res.status(400).json({ error: "Specified department does not exist" });
      }
    }

    const [updated] = await db
      .update(subjects)
      .set({
        name: String(name).trim(),
        ...(code ? { code: String(code).trim().toUpperCase() } : {}),
        ...(departmentId ? { departmentId: Number(departmentId) } : {}),
        description: description !== undefined ? String(description).trim() : undefined,
      })
      .where(eq(subjects.id, subjectId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Subject not found" });
    }

    res.status(200).json({ data: updated });
  } catch (e: any) {
    console.error(`PUT /subjects/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to update subject" });
  }
});

// DELETE /api/subjects/:id
router.delete("/:id", async (req, res) => {
  try {
    const subjectId = Number(req.params.id);
    if (!Number.isFinite(subjectId)) {
      return res.status(400).json({ error: "Invalid subject ID" });
    }

    // Constraint Check: Check if subject has associated classes
    const linkedClasses = await db
      .select({ id: classes.id, name: classes.name })
      .from(classes)
      .where(eq(classes.subjectId, subjectId));

    if (linkedClasses.length > 0) {
      return res.status(400).json({
        error: `Cannot delete subject. There are ${linkedClasses.length} class(es) offering this subject (${linkedClasses.map((c) => c.name).slice(0, 3).join(", ")}${linkedClasses.length > 3 ? "..." : ""}). Please reassign or delete these classes first.`,
      });
    }

    const [deleted] = await db
      .delete(subjects)
      .where(eq(subjects.id, subjectId))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Subject not found" });
    }

    res.status(200).json({ data: deleted, message: "Subject deleted successfully" });
  } catch (e: any) {
    console.error(`DELETE /subjects/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to delete subject" });
  }
});

export default router;
