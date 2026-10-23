import { type TemplateRecordDto, templateCreateWireSchema, templateUpdateWireSchema } from '@tresor/shared';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { templates } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { auth, requireAuth } from '../plugins/auth.js';
import { audit } from '../services/audit.js';

const idParams = z.object({ id: z.uuid() });

const toDto = (row: typeof templates.$inferSelect): TemplateRecordDto => ({
  id: row.id,
  payload: row.payload,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/** Entry templates, encrypted in the browser with the user's key. */
export async function templateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/templates', async (req) => {
    const { user } = auth(req);
    const rows = await app.db
      .select()
      .from(templates)
      .where(eq(templates.userId, user.id))
      .orderBy(asc(templates.createdAt));
    return { templates: rows.map(toDto) };
  });

  app.post('/templates', async (req, reply) => {
    const { user } = auth(req);
    const input = templateCreateWireSchema.parse(req.body);
    const [row] = await app.db
      .insert(templates)
      .values({ id: input.id, userId: user.id, payload: input.payload })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('CONFLICT', 'Template id already exists');
    await audit(app, req, { action: 'template.create', target: input.id });
    reply.code(201);
    return { template: toDto(row) };
  });

  app.put('/templates/:id', async (req) => {
    const { user } = auth(req);
    const { id } = idParams.parse(req.params);
    const input = templateUpdateWireSchema.parse(req.body);
    const [row] = await app.db
      .update(templates)
      .set({ payload: input.payload, updatedAt: new Date() })
      .where(and(eq(templates.id, id), eq(templates.userId, user.id)))
      .returning();
    if (!row) throw notFound('Template not found');
    return { template: toDto(row) };
  });

  app.delete('/templates/:id', async (req) => {
    const { user } = auth(req);
    const { id } = idParams.parse(req.params);
    const deleted = await app.db
      .delete(templates)
      .where(and(eq(templates.id, id), eq(templates.userId, user.id)))
      .returning({ id: templates.id });
    if (deleted.length === 0) throw notFound('Template not found');
    return { ok: true };
  });
}
