export type Category = { label: string; filters: string[]; highValue: boolean; enabled: boolean };
export type AreaCentre = { label: string; lat: number; lng: number; premium: boolean };
export const CATEGORIES: Category[] = [
  ["Dental clinic", ["amenity=dentist"]],
  ["Medical clinic / specialist", ["amenity=clinic", "amenity=doctors"]],
  ["Aesthetic / beauty", ["shop=beauty"]],
  ["Law firm", ["office=lawyer"]],
  ["Accounting / tax", ["office=accountant", "office=tax_advisor"]],
  ["Interior design / architect", ["shop=interior_decoration", "office=architect"]],
  ["Renovation / builder", ["craft=builder", "office=construction_company"]],
  ["Real estate agency", ["office=estate_agent"]],
  ["Private school / tuition / training", ["amenity=school", "amenity=college", "amenity=language_school", "amenity=music_school"]],
  ["Car dealership", ["shop=car"]],
  ["Hotel", ["tourism=hotel"]],
  ["Wedding services", ["shop=wedding", "shop=bridal"]],
  ["Company / trading / logistics", ["office=company", "office=logistics"]],
  ["Restaurant and cafe", ["amenity=restaurant", "amenity=cafe"]],
].map(([label, filters], i) => ({ label: label as string, filters: filters as string[], highValue: i < 12, enabled: i !== 13 }));
export const AREA_CENTRES: AreaCentre[] = [
  ["KLCC", 3.158, 101.712], ["Bukit Bintang", 3.147, 101.711],
  ["Bangsar", 3.130, 101.670], ["Mont Kiara / Sri Hartamas", 3.170, 101.650],
  ["Damansara Heights", 3.150, 101.662], ["Cheras", 3.085, 101.740],
  ["Setapak", 3.200, 101.720], ["Sentul", 3.185, 101.695],
  ["Kepong", 3.210, 101.635], ["Bukit Jalil", 3.060, 101.690],
].map(([label, lat, lng], i) => ({ label: label as string, lat: lat as number, lng: lng as number, premium: i < 5 }));
