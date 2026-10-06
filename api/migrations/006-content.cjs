module.exports={version:6,apply(db){db.exec("ALTER TABLE projects ADD COLUMN type TEXT NOT NULL DEFAULT 'mod' CHECK(type IN ('mod','resourcepack','shader','datapack','modpack'))");}};
