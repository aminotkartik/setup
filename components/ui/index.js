/**
 * Campus+ UI kit — one import point for every screen.
 *
 * The barrel re-exports the primitives so pages and feature components never
 * reach into implementation files, and so the whole product keeps one visual
 * language: `Button` is the same button in the composer, the marketplace, the
 * moderator queue and the admin tables.
 *
 * Modules without client hooks stay server-renderable; only the overlay and
 * theme surfaces are client modules.
 */

export { Button, LinkButton, IconButton, SheenButton, DeleteButton, KeycapButton } from '@/components/ui/buttons';
export { Field, Input, Textarea, Select, Checkbox, Switch } from '@/components/ui/fields';
export {
  Card,
  GlassSurface,
  PageHeader,
  SectionHeader,
  Badge,
  OfficialBadge,
  StaffDot,
  Notice,
  IdentityMark,
  Rail,
  RailCard,
} from '@/components/ui/surfaces';
export {
  WordLoader,
  OrbLoader,
  Spinner,
  LoadingPanel,
  Skeleton,
  SkeletonList,
  EmptyState,
  ErrorState,
  BackHomeLink,
} from '@/components/ui/states';
export { Modal, Sheet, Dropdown, MenuItem, MenuLink, Toast } from '@/components/ui/overlays';
export { ThemeSwitch, applyTheme, THEME_COOKIE } from '@/components/ui/theme';
export { TiltCard, WheelSelector } from '@/components/ui/interactive';
