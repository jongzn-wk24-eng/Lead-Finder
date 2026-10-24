import { importCategory } from "./index";
import { getSettings } from "../lead-db";
import { pool } from "@workspace/db";
try {
  const {categories}=await getSettings();
  for(const category of categories){
    const records=await importCategory(category);
    console.info(JSON.stringify({verification:category.label,normalizedCount:records.length,empty:records.length===0}));
  }
}finally{await pool.end();}
