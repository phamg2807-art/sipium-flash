'use client';

import { Suspense } from 'react';
import { AppShell } from '@/components/shell/AppShell';
import { CreateWorkspace } from '@/components/create/CreateWorkspace';

export default function CreatePage() {
  return (
    <Suspense fallback={<div className="container"><span className="spinner spinner--lg" /></div>}>
      <AppShell title="Create">
        <CreateWorkspace />
      </AppShell>
    </Suspense>
  );
}

export const dynamic = 'force-dynamic';
