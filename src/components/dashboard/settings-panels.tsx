'use client';

import * as React from 'react';

import { useRouter } from 'next/navigation';
import { AlertTriangle, Monitor, Palette, Smartphone } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { updateProfileAction } from '@/features/auth/actions';
import { updateBrandingAction } from '@/features/billing/actions';
import {
  deleteAccountAction,
  updateOrganizationAction,
  updatePreferencesAction,
} from '@/features/settings/actions';
import type { DeviceStrategy, ThemePreference } from '@prisma/client';

export function ProfilePanel({ name, email }: { name: string | null; email: string }) {
  const router = useRouter();
  const [value, setValue] = React.useState(name ?? '');
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await updateProfileAction({ name: value.trim(), avatarUrl: null });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Profile updated');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>How you appear across the product.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Name</Label>
            <Input
              id="profile-name"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" value={email} disabled className="max-w-sm" />
            <p className="text-xs text-muted-foreground">
              Your email is managed by your sign-in method and can&apos;t be changed here.
            </p>
          </div>

          <Button type="submit" loading={pending} disabled={!value.trim() || value.trim() === name}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function WorkspacePanel({ name, slug }: { name: string; slug: string }) {
  const router = useRouter();
  const [value, setValue] = React.useState(name);
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await updateOrganizationAction({ name: value.trim() });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Workspace updated');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>Your organisation, its projects and its billing.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="workspace-name">Name</Label>
            <Input
              id="workspace-name"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="workspace-slug">Identifier</Label>
            <Input id="workspace-slug" value={slug} disabled className="max-w-sm font-mono text-sm" />
          </div>

          <Button type="submit" loading={pending} disabled={!value.trim() || value.trim() === name}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

export function PreferencesPanel({
  theme,
  defaultDevice,
  weeklyDigest,
  auditCompleteEmails,
  productUpdates,
  timezone,
}: {
  theme: ThemePreference;
  defaultDevice: DeviceStrategy;
  weeklyDigest: boolean;
  auditCompleteEmails: boolean;
  productUpdates: boolean;
  timezone: string;
}) {
  const router = useRouter();
  const [state, setState] = React.useState({
    theme,
    defaultDevice,
    weeklyDigest,
    auditCompleteEmails,
    productUpdates,
    timezone,
  });
  const [pending, setPending] = React.useState(false);

  async function save(next: typeof state) {
    setState(next);
    setPending(true);
    const result = await updatePreferencesAction(next);
    setPending(false);

    if (!result.ok) {
      // Roll back so the switch never shows a state the server rejected.
      setState(state);
      toast.error(result.error.message);
      return;
    }
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferences</CardTitle>
        <CardDescription>Defaults for new audits, and what we email you about.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="default-device">Default audit device</Label>
          <Select
            value={state.defaultDevice}
            onValueChange={(value) => void save({ ...state, defaultDevice: value as DeviceStrategy })}
          >
            <SelectTrigger id="default-device" className="max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MOBILE">
                <span className="flex items-center gap-2">
                  <Smartphone className="size-4" /> Mobile — how Google indexes
                </span>
              </SelectItem>
              <SelectItem value="DESKTOP">
                <span className="flex items-center gap-2">
                  <Monitor className="size-4" /> Desktop
                </span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4 border-t border-border pt-6">
          <p className="text-sm font-medium">Email</p>

          {(
            [
              {
                key: 'auditCompleteEmails' as const,
                label: 'Audit complete',
                hint: 'A summary when an audit finishes.',
              },
              {
                key: 'weeklyDigest' as const,
                label: 'Weekly digest',
                hint: 'How your scores moved over the week.',
              },
              {
                key: 'productUpdates' as const,
                label: 'Product updates',
                hint: 'Occasional notes about new features.',
              },
            ]
          ).map((option) => (
            <div key={option.key} className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <Label htmlFor={option.key} className="cursor-pointer">
                  {option.label}
                </Label>
                <p className="mt-0.5 text-xs text-muted-foreground">{option.hint}</p>
              </div>
              <Switch
                id={option.key}
                checked={state[option.key]}
                disabled={pending}
                onCheckedChange={(checked) => void save({ ...state, [option.key]: checked })}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function BrandingPanel({
  brandColor,
  brandLogoUrl,
  reportFooterText,
  enabled,
}: {
  brandColor: string | null;
  brandLogoUrl: string | null;
  reportFooterText: string | null;
  enabled: boolean;
}) {
  const router = useRouter();
  const [state, setState] = React.useState({
    brandColor: brandColor ?? '#6366f1',
    brandLogoUrl: brandLogoUrl ?? '',
    reportFooterText: reportFooterText ?? '',
  });
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    const result = await updateBrandingAction(state);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Branding saved');
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="size-4 text-primary" aria-hidden="true" />
          White-label reports
        </CardTitle>
        <CardDescription>
          {enabled
            ? 'Exported PDFs carry your logo and brand colour instead of ours.'
            : 'Available on the Agency plan — put your own brand on every client report.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <fieldset disabled={!enabled} className="space-y-4 disabled:opacity-60">
            <div className="space-y-1.5">
              <Label htmlFor="brand-color">Brand colour</Label>
              <div className="flex items-center gap-2">
                <input
                  id="brand-color"
                  type="color"
                  value={state.brandColor}
                  onChange={(event) => setState({ ...state, brandColor: event.target.value })}
                  className="size-10 cursor-pointer rounded-lg border border-input bg-transparent"
                />
                <Input
                  value={state.brandColor}
                  onChange={(event) => setState({ ...state, brandColor: event.target.value })}
                  className="max-w-[10rem] font-mono text-sm"
                  aria-label="Brand colour hex value"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brand-logo">Logo URL</Label>
              <Input
                id="brand-logo"
                type="url"
                placeholder="https://yourcompany.com/logo.png"
                value={state.brandLogoUrl}
                onChange={(event) => setState({ ...state, brandLogoUrl: event.target.value })}
                className="max-w-md"
              />
              <p className="text-xs text-muted-foreground">
                A PNG or SVG on a transparent background works best. Around 200px wide.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="brand-footer">Report footer</Label>
              <Input
                id="brand-footer"
                placeholder="Prepared by Your Agency · hello@youragency.com"
                value={state.reportFooterText}
                onChange={(event) => setState({ ...state, reportFooterText: event.target.value })}
                className="max-w-md"
              />
            </div>

            <Button type="submit" loading={pending}>
              Save branding
            </Button>
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

export function DangerZone({ email }: { email: string }) {
  const [open, setOpen] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState('');
  const [pending, setPending] = React.useState(false);

  async function handleDelete() {
    setPending(true);
    const result = await deleteAccountAction({ confirmation });
    setPending(false);

    if (!result.ok) {
      toast.error(result.error.message);
      return;
    }

    // Full navigation, not a router push: the session is gone and every
    // cached route in the client router now points at deleted data.
    window.location.href = '/';
  }

  return (
    <>
      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Delete account
          </CardTitle>
          <CardDescription>
            Permanently removes your account, your workspace, and every audit and report in it. This
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            Delete my account
          </Button>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              Every project, website, audit and report will be deleted immediately. There is no recovery.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="delete-confirmation">
              Type <span className="font-mono">{email}</span> to confirm
            </Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              autoComplete="off"
            />
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={pending}
              disabled={confirmation.trim().toLowerCase() !== email.toLowerCase()}
              onClick={handleDelete}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
