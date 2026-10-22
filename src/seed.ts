import { db } from "./db/index.js";
import { departments, subjects, classes, user, enrollments } from "./db/schema/index.js";
import { eq } from "drizzle-orm";
import crypto from "crypto";

async function seed() {
  console.log("Starting seed...");

  // 1. Ensure Admin user exists
  const existingAdmin = await db.select().from(user).where(eq(user.email, "admin@classroom.com"));
  let adminId = existingAdmin[0]?.id;
  if (!adminId) {
    adminId = crypto.randomUUID();
    await db.insert(user).values({
      id: adminId,
      name: "Admin Sarah Mitchell",
      email: "admin@classroom.com",
      emailVerified: true,
      role: "admin",
      image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150",
    });
    console.log("Created admin user: admin@classroom.com");
  }

  // 2. Ensure Teacher user exists
  const existingTeacher = await db.select().from(user).where(eq(user.email, "teacher@classroom.com"));
  let teacherId = existingTeacher[0]?.id;
  if (!teacherId) {
    teacherId = crypto.randomUUID();
    await db.insert(user).values({
      id: teacherId,
      name: "Prof. Alex Rivera",
      email: "teacher@classroom.com",
      emailVerified: true,
      role: "teacher",
      image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150",
    });
    console.log("Created teacher user: teacher@classroom.com");
  }

  // 3. Ensure Students exist
  const sampleStudents = [
    { name: "Liam Johnson", email: "student1@classroom.com", image: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150" },
    { name: "Emma Davis", email: "student2@classroom.com", image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150" },
    { name: "Noah Patel", email: "student3@classroom.com", image: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150" },
    { name: "Sophia Garcia", email: "student4@classroom.com", image: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150" },
    { name: "Lucas Chen", email: "student5@classroom.com", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150" },
  ];

  const studentIds: string[] = [];
  for (const s of sampleStudents) {
    const existing = await db.select().from(user).where(eq(user.email, s.email));
    const first = existing[0];
    if (first) {
      studentIds.push(first.id);
    } else {
      const id = crypto.randomUUID();
      await db.insert(user).values({
        id,
        name: s.name,
        email: s.email,
        emailVerified: true,
        role: "student",
        image: s.image,
      });
      studentIds.push(id);
      console.log(`Created student: ${s.email}`);
    }
  }

  // 4. Ensure Departments exist
  const existingDepts = await db.select().from(departments);
  let csDeptId = existingDepts.find((d) => d.code === "CS")?.id;
  if (!csDeptId) {
    const created = await db.insert(departments).values({
      code: "CS",
      name: "Computer Science",
      description: "Department of Computing & Information Systems",
    }).returning();
    if (created[0]) csDeptId = created[0].id;
  }

  let mathDeptId = existingDepts.find((d) => d.code === "MATH")?.id;
  if (!mathDeptId) {
    const created = await db.insert(departments).values({
      code: "MATH",
      name: "Mathematics",
      description: "Pure and Applied Mathematics",
    }).returning();
    if (created[0]) mathDeptId = created[0].id;
  }

  // 5. Ensure Subjects exist
  const existingSubjects = await db.select().from(subjects);
  let cs101Id = existingSubjects.find((s) => s.code === "CS101")?.id;
  if (!cs101Id && csDeptId) {
    const created = await db.insert(subjects).values({
      name: "Data Structures & Algorithms",
      code: "CS101",
      departmentId: csDeptId,
      description: "Core algorithms, data structures, trees, graphs, and complexity analysis",
    }).returning();
    if (created[0]) cs101Id = created[0].id;
  }

  let web201Id = existingSubjects.find((s) => s.code === "WEB201")?.id;
  if (!web201Id && csDeptId) {
    const created = await db.insert(subjects).values({
      name: "Full Stack Web Development",
      code: "WEB201",
      departmentId: csDeptId,
      description: "Modern full-stack web applications with React, Node, and TypeScript",
    }).returning();
    if (created[0]) web201Id = created[0].id;
  }

  // 6. Ensure Classes exist
  const existingClasses = await db.select().from(classes);
  let class1 = existingClasses[0];
  if (!class1 && cs101Id && teacherId) {
    const created = await db.insert(classes).values({
      name: "CS101: Morning Batch A",
      subjectId: cs101Id,
      teacherId,
      inviteCode: "DSA2026",
      capacity: 30,
      status: "active",
      bannerUrl: "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800",
      description: "In-depth algorithms exploration with hands-on labs and problem sets",
      schedules: [
        { day: "Monday", startTime: "09:00", endTime: "10:30" },
        { day: "Wednesday", startTime: "09:00", endTime: "10:30" },
        { day: "Friday", startTime: "09:00", endTime: "10:30" },
      ],
    }).returning();
    class1 = created[0];
  }

  // 7. Seed Enrollments
  if (class1 && studentIds.length > 0) {
    for (let i = 0; i < Math.min(3, studentIds.length); i++) {
      const studentId = studentIds[i];
      if (!studentId) continue;
      const existing = await db
        .select()
        .from(enrollments)
        .where(eq(enrollments.studentId, studentId));

      if (existing.length === 0) {
        const daysAgo = i * 2;
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - daysAgo);

        await db.insert(enrollments).values({
          classId: class1.id,
          studentId,
          createdAt: pastDate,
        });
        console.log(`Enrolled student ${studentId} in class ${class1.id}`);
      }
    }
  }

  console.log("Seed completed successfully!");
}

seed().catch(console.error);
