'use client';

import * as React from 'react';

import { Download } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/**
 * Report download.
 *
 * Fetched rather than linked, for two reasons: the endpoint can return a
 * plan-gated 402, which a plain anchor would render as a raw JSON error page;
 * and the response may be either a PDF or an HTML fallback, which the button
 * resolves by inspecting the content type rather than guessing up front.
 */
export function ExportReportButton({ auditId }: { auditId: string }) {
  const [pending, setPending] = React.useState(false);

  async function handleClick() {
    setPending(true);

    try {
      const response = await fetch(`/api/reports/${auditId}`);

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(payload?.error ?? 'Could not generate the report.');
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      if (contentType.includes('application/pdf')) {
        const filenameMatch = /filename="([^"]+)"/.exec(
          response.headers.get('content-disposition') ?? '',
        );

        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = filenameMatch?.[1] ?? 'audit-report.pdf';
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        toast.success('Report downloaded');
      } else {
        // HTML fallback: open it so the user can print to PDF themselves.
        window.open(objectUrl, '_blank', 'noopener');
        toast.info('Opened the report — use your browser’s print dialog to save it as a PDF.');
      }

      // Revoke on the next tick; revoking immediately can cancel the download
      // in some browsers before it starts.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      toast.error('Could not generate the report. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} loading={pending} loadingText="Preparing…">
      <Download className="size-4" />
      Export report
    </Button>
  );
}
