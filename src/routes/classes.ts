import { and, desc, eq, getTableColumns, ilike, or, sql, asc } from "drizzle-orm";
import express from "express";
import { db } from "../db/index.js";
import { classes, departments, subjects, user, enrollments } from "../db/schema/index.js";

const router = express.Router();

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let result = "";
  for (let i = 0; i < 7; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// GET /api/classes
router.get("/", async (req, res) => {
  try {
    const {
      search,
      subject,
      teacher,
      status,
      page = 1,
      limit = 10,
      _sort = "createdAt",
      _order = "desc",
    } = req.query;

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
          ilike(classes.name, `%${search}%`),
          ilike(classes.inviteCode, `%${search}%`),
          ilike(subjects.code, `%${search}%`),
          ilike(subjects.name, `%${search}%`)
        )
      );
    }

    if (subject && subject !== "all") {
      const subjId = Number(subject);
      if (Number.isFinite(subjId)) {
        filterConditions.push(eq(classes.subjectId, subjId));
      } else {
        filterConditions.push(ilike(subjects.name, `%${subject}%`));
      }
    }

    if (teacher && teacher !== "all") {
      filterConditions.push(
        or(
          eq(classes.teacherId, String(teacher)),
          ilike(user.name, `%${teacher}%`)
        )
      );
    }

    if (status && status !== "all") {
      filterConditions.push(eq(classes.status, status as "active" | "inactive" | "archived"));
    }

    const whereClause =
      filterConditions.length > 0 ? and(...filterConditions) : undefined;

    const countResult = await db
      .select({ count: sql<number>`count(distinct ${classes.id})` })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .where(whereClause);

    const totalCount = Number(countResult[0]?.count ?? 0);

    const sortOrder = String(_order).toLowerCase() === "asc" ? asc : desc;
    const sortField =
      String(_sort) === "name"
        ? classes.name
        : String(_sort) === "capacity"
        ? classes.capacity
        : String(_sort) === "status"
        ? classes.status
        : classes.createdAt;

    const classesList = await db
      .select({
        ...getTableColumns(classes),
        subject: { ...getTableColumns(subjects) },
        teacher: { ...getTableColumns(user) },
        enrolledCount: sql<number>`cast(count(distinct ${enrollments.id}) as integer)`,
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .leftJoin(enrollments, eq(classes.id, enrollments.classId))
      .where(whereClause)
      .groupBy(classes.id, subjects.id, user.id)
      .orderBy(sortOrder(sortField))
      .limit(limitPerPage)
      .offset(offset);

    const userRole = String(req.query.userRole || "").toLowerCase();
    const sanitizedList =
      userRole === "student"
        ? classesList.map((c) => ({ ...c, inviteCode: undefined }))
        : classesList;

    res.status(200).json({
      data: sanitizedList,
      pagination: {
        page: currentPage,
        limit: limitPerPage,
        total: totalCount,
        totalPages: Math.ceil(totalCount / limitPerPage),
      },
    });
  } catch (e: any) {
    console.error(`GET /classes error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get classes" });
  }
});

// GET /api/classes/:id
router.get("/:id", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class ID" });
    }

    const [classDetails] = await db
      .select({
        ...getTableColumns(classes),
        subject: {
          ...getTableColumns(subjects),
        },
        department: {
          ...getTableColumns(departments),
        },
        teacher: {
          ...getTableColumns(user),
        },
        enrolledCount: sql<number>`cast(count(distinct ${enrollments.id}) as integer)`,
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(user, eq(classes.teacherId, user.id))
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .leftJoin(enrollments, eq(classes.id, enrollments.classId))
      .where(eq(classes.id, classId))
      .groupBy(classes.id, subjects.id, user.id, departments.id);

    if (!classDetails) return res.status(404).json({ error: "No class found" });

    const userRole = String(req.query.userRole || "").toLowerCase();
    if (userRole === "student") {
      classDetails.inviteCode = undefined as any;
    }

    res.status(200).json({ data: classDetails });
  } catch (e: any) {
    console.error(`GET /classes/:id error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get class details" });
  }
});

// POST /api/classes
router.post("/", async (req, res) => {
  try {
    const {
      name,
      description,
      subjectId,
      teacherId,
      capacity = 50,
      status = "active",
      bannerUrl,
      bannerCldPubId,
      inviteCode,
      schedules = [],
    } = req.body;

    if (!name || !subjectId || !teacherId) {
      return res.status(400).json({
        error: "Class name, subjectId, and teacherId are required",
      });
    }

    let code = inviteCode ? String(inviteCode).trim().toUpperCase() : generateInviteCode();

    // Ensure invite code is unique
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db
        .select({ id: classes.id })
        .from(classes)
        .where(eq(classes.inviteCode, code));
      if (existing.length === 0) break;
      code = generateInviteCode();
      attempts++;
    }

    const [createdClass] = await db
      .insert(classes)
      .values({
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        subjectId: Number(subjectId),
        teacherId: String(teacherId),
        capacity: Number(capacity) || 50,
        status: (status as "active" | "inactive" | "archived") || "active",
        bannerUrl: bannerUrl || null,
        bannerCldPubId: bannerCldPubId || null,
        inviteCode: code,
        schedules: Array.isArray(schedules) ? schedules : [],
      })
      .returning();

    if (!createdClass) {
      throw new Error("Failed to insert class");
    }

    res.status(201).json({ data: createdClass });
  } catch (e: any) {
    console.error(`POST /classes error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to create class" });
  }
});

// PUT /api/classes/:id
router.put("/:id", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class ID" });
    }

    const {
      name,
      description,
      subjectId,
      teacherId,
      capacity,
      status,
      bannerUrl,
      bannerCldPubId,
      inviteCode,
      schedules,
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Class name is required" });
    }

    if (inviteCode) {
      const existing = await db
        .select({ id: classes.id })
        .from(classes)
        .where(
          and(
            eq(classes.inviteCode, String(inviteCode).trim().toUpperCase()),
            sql`${classes.id} != ${classId}`
          )
        );
      if (existing.length > 0) {
        return res.status(400).json({ error: `Invite code '${inviteCode}' already taken` });
      }
    }

    const [updatedClass] = await db
      .update(classes)
      .set({
        name: String(name).trim(),
        description: description !== undefined ? String(description).trim() : undefined,
        ...(subjectId ? { subjectId: Number(subjectId) } : {}),
        ...(teacherId ? { teacherId: String(teacherId) } : {}),
        ...(capacity !== undefined ? { capacity: Number(capacity) } : {}),
        ...(status ? { status: status as "active" | "inactive" | "archived" } : {}),
        ...(bannerUrl !== undefined ? { bannerUrl } : {}),
        ...(bannerCldPubId !== undefined ? { bannerCldPubId } : {}),
        ...(inviteCode ? { inviteCode: String(inviteCode).trim().toUpperCase() } : {}),
        ...(schedules !== undefined ? { schedules: Array.isArray(schedules) ? schedules : [] } : {}),
      })
      .where(eq(classes.id, classId))
      .returning();

    if (!updatedClass) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.status(200).json({ data: updatedClass });
  } catch (e: any) {
    console.error(`PUT /classes/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to update class" });
  }
});

// POST /api/classes/:id/regenerate-invite
router.post("/:id/regenerate-invite", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class ID" });
    }

    let code = generateInviteCode();
    let attempts = 0;
    while (attempts < 5) {
      const existing = await db
        .select({ id: classes.id })
        .from(classes)
        .where(eq(classes.inviteCode, code));
      if (existing.length === 0) break;
      code = generateInviteCode();
      attempts++;
    }

    const [updated] = await db
      .update(classes)
      .set({ inviteCode: code })
      .where(eq(classes.id, classId))
      .returning({ id: classes.id, inviteCode: classes.inviteCode });

    if (!updated) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.status(200).json({ data: updated });
  } catch (e: any) {
    console.error(`POST /classes/:id/regenerate-invite error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to regenerate invite code" });
  }
});

// DELETE /api/classes/:id
router.delete("/:id", async (req, res) => {
  try {
    const classId = Number(req.params.id);
    if (!Number.isFinite(classId)) {
      return res.status(400).json({ error: "Invalid class ID" });
    }

    // Constraint Check: Check enrolled student count
    const [enrolled] = await db
      .select({ count: sql<number>`count(*)` })
      .from(enrollments)
      .where(eq(enrollments.classId, classId));

    const enrolledCount = Number(enrolled?.count ?? 0);

    // If query has force=true or no students, proceed
    const force = req.query.force === "true";
    if (enrolledCount > 0 && !force) {
      return res.status(400).json({
        error: `Cannot delete class. There are currently ${enrolledCount} enrolled student(s) in this class. Please unenroll all students first or confirm deletion to proceed.`,
        enrolledCount,
      });
    }

    // Delete enrollments if force
    if (enrolledCount > 0) {
      await db.delete(enrollments).where(eq(enrollments.classId, classId));
    }

    const [deleted] = await db
      .delete(classes)
      .where(eq(classes.id, classId))
      .returning();

    if (!deleted) {
      return res.status(404).json({ error: "Class not found" });
    }

    res.status(200).json({ data: deleted, message: "Class deleted successfully" });
  } catch (e: any) {
    console.error(`DELETE /classes/:id error: ${e?.message || e}`);
    res.status(500).json({ error: e?.message || "Failed to delete class" });
  }
});

export default router;
