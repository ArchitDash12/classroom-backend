import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import express from "express";
import { db } from "../db/index.js";
import { classes, departments, subjects, user, enrollments } from "../db/schema/index.js";

const router = express.Router();

// GET /api/dashboard/stats
router.get("/stats", async (req, res) => {
  try {
    // 1. Overall Counts
    const userStatsRows = await db.select({
      totalUsers: sql<number>`cast(count(*) as integer)`,
      studentsCount: sql<number>`cast(count(case when ${user.role} = 'student' then 1 end) as integer)`,
      teachersCount: sql<number>`cast(count(case when ${user.role} = 'teacher' then 1 end) as integer)`,
      adminsCount: sql<number>`cast(count(case when ${user.role} = 'admin' then 1 end) as integer)`,
    }).from(user);
    const userStats = userStatsRows[0] || { totalUsers: 0, studentsCount: 0, teachersCount: 0, adminsCount: 0 };

    const deptStatsRows = await db.select({
      totalDepartments: sql<number>`cast(count(*) as integer)`,
    }).from(departments);
    const deptStats = deptStatsRows[0] || { totalDepartments: 0 };

    const subjStatsRows = await db.select({
      totalSubjects: sql<number>`cast(count(*) as integer)`,
    }).from(subjects);
    const subjStats = subjStatsRows[0] || { totalSubjects: 0 };

    const classStatsRows = await db.select({
      totalClasses: sql<number>`cast(count(*) as integer)`,
      activeClasses: sql<number>`cast(count(case when ${classes.status} = 'active' then 1 end) as integer)`,
      totalCapacity: sql<number>`cast(coalesce(sum(${classes.capacity}), 0) as integer)`,
    }).from(classes);
    const classStats = classStatsRows[0] || { totalClasses: 0, activeClasses: 0, totalCapacity: 0 };

    const enrollmentStatsRows = await db.select({
      totalEnrollments: sql<number>`cast(count(*) as integer)`,
    }).from(enrollments);
    const enrollmentStats = enrollmentStatsRows[0] || { totalEnrollments: 0 };

    // 2. Class-by-Class capacity analysis
    const classCapacities = await db
      .select({
        id: classes.id,
        name: classes.name,
        capacity: classes.capacity,
        status: classes.status,
        inviteCode: classes.inviteCode,
        subjectName: subjects.name,
        departmentName: departments.name,
        enrolledCount: sql<number>`cast(count(distinct ${enrollments.id}) as integer)`,
      })
      .from(classes)
      .leftJoin(subjects, eq(classes.subjectId, subjects.id))
      .leftJoin(departments, eq(subjects.departmentId, departments.id))
      .leftJoin(enrollments, eq(classes.id, enrollments.classId))
      .groupBy(classes.id, subjects.name, departments.name);

    let availableCount = 0;
    let nearCapacityCount = 0;
    let fullCount = 0;
    let totalFillRateSum = 0;
    const capacityWarnings: any[] = [];

    classCapacities.forEach((c) => {
      const cap = Math.max(1, c.capacity);
      const enrolled = c.enrolledCount;
      const fillRate = (enrolled / cap) * 100;
      totalFillRateSum += fillRate;

      if (enrolled >= cap) {
        fullCount++;
        capacityWarnings.push({
          ...c,
          fillPercentage: 100,
          warningLevel: "critical",
          label: "Full (100%)",
        });
      } else if (fillRate >= 80) {
        nearCapacityCount++;
        capacityWarnings.push({
          ...c,
          fillPercentage: Math.round(fillRate),
          warningLevel: "warning",
          label: `Near Capacity (${Math.round(fillRate)}%)`,
        });
      } else {
        availableCount++;
      }
    });

    const avgFillRate =
      classCapacities.length > 0
        ? Math.round(totalFillRateSum / classCapacities.length)
        : 0;

    // 3. Classes by Department
    const classesByDept = await db
      .select({
        name: departments.name,
        code: departments.code,
        classesCount: sql<number>`cast(count(distinct ${classes.id}) as integer)`,
        subjectsCount: sql<number>`cast(count(distinct ${subjects.id}) as integer)`,
      })
      .from(departments)
      .leftJoin(subjects, eq(departments.id, subjects.departmentId))
      .leftJoin(classes, eq(subjects.id, classes.subjectId))
      .groupBy(departments.id)
      .orderBy(desc(sql`count(distinct ${classes.id})`));

    // 4. Enrollment Trends (past 14 days)
    const enrollmentTrendsRaw = await db
      .select({
        date: sql<string>`to_char(${enrollments.createdAt}, 'YYYY-MM-DD')`,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(enrollments)
      .groupBy(sql`to_char(${enrollments.createdAt}, 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${enrollments.createdAt}, 'YYYY-MM-DD')`);

    const trendsMap = new Map<string, number>();
    enrollmentTrendsRaw.forEach((row) => {
      if (row.date) trendsMap.set(String(row.date), Number(row.count));
    });

    const enrollmentTrends = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const displayLabel = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      enrollmentTrends.push({
        date: displayLabel,
        rawDate: dateStr,
        enrollments: trendsMap.get(dateStr) ?? 0,
      });
    }

    // 5. User Distribution
    const userDistribution = [
      { name: "Students", value: userStats.studentsCount ?? 0, fill: "#3b82f6" },
      { name: "Teachers", value: userStats.teachersCount ?? 0, fill: "#10b981" },
      { name: "Admins", value: userStats.adminsCount ?? 0, fill: "#8b5cf6" },
    ];

    // 6. Capacity Status
    const capacityStatus = [
      { name: "Available (<80%)", value: availableCount, fill: "#10b981" },
      { name: "Near Capacity (80-99%)", value: nearCapacityCount, fill: "#f59e0b" },
      { name: "Full (100%)", value: fullCount, fill: "#ef4444" },
    ];

    // 7. Recent Activity Feed
    const recentEnrollments = await db
      .select({
        id: enrollments.id,
        createdAt: enrollments.createdAt,
        studentName: user.name,
        studentEmail: user.email,
        studentImage: user.image,
        className: classes.name,
        type: sql<string>`'enrollment'`,
      })
      .from(enrollments)
      .innerJoin(user, eq(enrollments.studentId, user.id))
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .orderBy(desc(enrollments.createdAt))
      .limit(6);

    const recentClasses = await db
      .select({
        id: classes.id,
        createdAt: classes.createdAt,
        name: classes.name,
        capacity: classes.capacity,
        teacherName: user.name,
        type: sql<string>`'class_created'`,
      })
      .from(classes)
      .leftJoin(user, eq(classes.teacherId, user.id))
      .orderBy(desc(classes.createdAt))
      .limit(4);

    const recentUsers = await db
      .select({
        id: user.id,
        createdAt: user.createdAt,
        name: user.name,
        email: user.email,
        role: user.role,
        image: user.image,
        type: sql<string>`'user_joined'`,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(4);

    const activities = [
      ...recentEnrollments.map((e) => ({
        id: `enroll-${e.id}`,
        title: `${e.studentName} enrolled in ${e.className}`,
        subtitle: e.studentEmail,
        timestamp: e.createdAt,
        type: "enrollment",
        avatar: e.studentImage,
      })),
      ...recentClasses.map((c) => ({
        id: `class-${c.id}`,
        title: `Class "${c.name}" created`,
        subtitle: `Instructor: ${c.teacherName || "Unassigned"} • Cap: ${c.capacity}`,
        timestamp: c.createdAt,
        type: "class_created",
      })),
      ...recentUsers.map((u) => ({
        id: `user-${u.id}`,
        title: `${u.name} joined as ${u.role}`,
        subtitle: u.email,
        timestamp: u.createdAt,
        type: "user_joined",
        avatar: u.image,
      })),
    ].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    ).slice(0, 10);

    res.status(200).json({
      data: {
        metrics: {
          totalUsers: userStats.totalUsers,
          studentsCount: userStats.studentsCount,
          teachersCount: userStats.teachersCount,
          adminsCount: userStats.adminsCount,
          totalDepartments: deptStats.totalDepartments,
          totalSubjects: subjStats.totalSubjects,
          totalClasses: classStats.totalClasses,
          activeClasses: classStats.activeClasses,
          totalCapacity: classStats.totalCapacity,
          totalEnrollments: enrollmentStats.totalEnrollments,
          avgFillRate,
        },
        charts: {
          enrollmentTrends,
          classesByDepartment: classesByDept,
          capacityStatus,
          userDistribution,
        },
        capacityWarnings,
        activityFeed: activities,
      },
    });
  } catch (e: any) {
    console.error(`GET /dashboard/stats error: ${e?.message || e}`);
    res.status(500).json({ error: "Failed to get dashboard statistics" });
  }
});

// GET /api/search
router.get("/search", async (req, res) => {
  try {
    const query = String(req.query.q || "").trim();
    if (!query || query.length < 2) {
      return res.status(200).json({
        data: {
          classes: [],
          subjects: [],
          departments: [],
          users: [],
        },
      });
    }

    const term = `%${query}%`;

    const userRole = String(req.query.userRole || "").toLowerCase();

    const [matchedClassesRaw, matchedSubjects, matchedDepartments, matchedUsers] =
      await Promise.all([
        db
          .select({
            id: classes.id,
            name: classes.name,
            inviteCode: classes.inviteCode,
            status: classes.status,
            capacity: classes.capacity,
          })
          .from(classes)
          .where(
            or(ilike(classes.name, term), ilike(classes.inviteCode, term))
          )
          .limit(5),

        db
          .select({
            id: subjects.id,
            name: subjects.name,
            code: subjects.code,
          })
          .from(subjects)
          .where(
            or(ilike(subjects.name, term), ilike(subjects.code, term))
          )
          .limit(5),

        db
          .select({
            id: departments.id,
            name: departments.name,
            code: departments.code,
          })
          .from(departments)
          .where(
            or(ilike(departments.name, term), ilike(departments.code, term))
          )
          .limit(5),

        db
          .select({
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            image: user.image,
          })
          .from(user)
          .where(or(ilike(user.name, term), ilike(user.email, term)))
          .limit(5),
      ]);

    const matchedClasses = matchedClassesRaw.map((c) => ({
      ...c,
      inviteCode: userRole === "student" ? undefined : c.inviteCode,
    }));

    res.status(200).json({
      data: {
        classes: matchedClasses,
        subjects: matchedSubjects,
        departments: matchedDepartments,
        users: matchedUsers,
      },
    });
  } catch (e: any) {
    console.error(`GET /search error: ${e?.message || e}`);
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
