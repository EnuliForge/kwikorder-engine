import OrderClient from "./OrderClient";
import { supaAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

const TENANT_ID = "00000000-0000-0000-0000-000000000001";
// TODO: later we'll make this dynamic per QR code
const TABLE_ID = "HL_TB0034";

// Types that match what OrderClient expects
type ModifierOption = {
  id: string;
  label: string;
  price_delta_minor: number;
  sort_order: number;
};

type ModifierGroup = {
  id: string;
  name: string;
  prompt: string;
  type: "single" | "multi";
  required: boolean;
  sort_order: number;
  options: ModifierOption[];
};

export type MenuItem = {
  id: string;
  name: string;
  sku: string;
  stream: "kitchen" | "bar" | "special";
  price_minor: number;
  modifier_groups: ModifierGroup[];
};

// Raw row shape from Supabase query before we normalize
type RawModifierOptionRow = {
  id: string;
  label: string;
  price_delta_minor: number | null;
  sort_order: number | null;
};

type RawModifierGroupRow = {
  id: string;
  name: string;
  prompt: string;
  type: "single" | "multi";
  required: boolean;
  sort_order: number | null;
  modifier_options: RawModifierOptionRow[] | null;
};

type RawItemModifierGroupLink = {
  sort_order: number | null;
  modifier_groups: RawModifierGroupRow;
};

type RawMenuItemRow = {
  id: string;
  name: string;
  sku: string;
  stream: "kitchen" | "bar" | "special";
  price_minor: number;
  sort_order: number | null;
  item_modifier_groups: RawItemModifierGroupLink[] | null;
};

export default async function OrderPage() {
  console.log("DEBUG service role present?", !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log("DEBUG anon present?", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    const supabase = supaAdmin();

  // --- 1. Fetch menu + nested modifier info
  const { data: rawItems, error: itemsErr } = await supabase
    .from("menu_items")
    .select(
      `
      id,
      name,
      sku,
      stream,
      price_minor,
      sort_order,
      item_modifier_groups (
        sort_order,
        modifier_groups (
          id,
          name,
          prompt,
          type,
          required,
          sort_order,
          modifier_options (
            id,
            label,
            price_delta_minor,
            sort_order
          )
        )
      )
    `
    )
    .eq("tenant_id", TENANT_ID)
    .eq("active", true)
    .order("sort_order", { ascending: true });

  if (itemsErr) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-semibold mb-2">Place Order</h1>
        <p className="text-red-600">
          Error loading menu: {itemsErr.message}
        </p>
      </main>
    );
  }

  // rawItems could be null, so default to []
  const typedRows: RawMenuItemRow[] = (rawItems ?? []) as RawMenuItemRow[];

  // --- 2. Normalize rows into nice stable props for the client
  const menu: MenuItem[] = typedRows.map((row) => {
    // sort modifier groups by the link.order then group's own sort_order
    const modifierGroups: ModifierGroup[] = (row.item_modifier_groups ?? [])
      .slice() // shallow copy before sort
      .sort((a, b) => {
        const aLinkSort = a.sort_order ?? 0;
        const bLinkSort = b.sort_order ?? 0;
        if (aLinkSort !== bLinkSort) return aLinkSort - bLinkSort;
        const aGroupSort = a.modifier_groups.sort_order ?? 0;
        const bGroupSort = b.modifier_groups.sort_order ?? 0;
        return aGroupSort - bGroupSort;
      })
      .map((link): ModifierGroup => {
        const g = link.modifier_groups;
        const opts: ModifierOption[] = (g.modifier_options ?? [])
          .slice()
          .sort((oa, ob) => {
            const ao = oa.sort_order ?? 0;
            const bo = ob.sort_order ?? 0;
            return ao - bo;
          })
          .map((opt): ModifierOption => ({
            id: opt.id,
            label: opt.label,
            price_delta_minor: opt.price_delta_minor ?? 0,
            sort_order: opt.sort_order ?? 0,
          }));

        return {
          id: g.id,
          name: g.name,
          prompt: g.prompt,
          type: g.type,
          required: !!g.required,
          sort_order: g.sort_order ?? 0,
          options: opts,
        };
      });

    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      stream: row.stream,
      price_minor: row.price_minor,
      modifier_groups: modifierGroups,
    };
  });

  // --- 3. Render client component with clean data
  return (
    <OrderClient
      tableId={TABLE_ID}
      tenantId={TENANT_ID}
      menu={menu}
    />
  );
}
