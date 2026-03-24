-- Cleanup script: удаление осиротевших данных без связанного магазина
-- Выполнено: 2026-03-24 (Task #27)
-- Результат: marketplace_settings=0, wb_supplies=64 closed, product_marketplace_links=0, orders=69 deleted

-- 1. Удалить осиротевшие API ключи (store_id не ссылается ни на один магазин)
DELETE FROM marketplace_settings
WHERE store_id NOT IN (SELECT id FROM stores);

-- 2. Закрыть осиротевшие открытые поставки WB (store_id IS NULL = баг)
UPDATE wb_supplies
SET status = 'closed', closed_at = NOW()
WHERE (store_id NOT IN (SELECT id FROM stores) OR store_id IS NULL)
  AND status = 'open';

-- 3. Удалить осиротевшие ссылки товаров на магазины
DELETE FROM product_marketplace_links
WHERE store_id NOT IN (SELECT id FROM stores);

-- 4. Удалить осиротевшие заказы (42 WB + 27 Yandex без store_id)
DELETE FROM orders
WHERE store_id NOT IN (SELECT id FROM stores)
   OR store_id IS NULL;

-- Проверка — все должны вернуть 0:
-- SELECT COUNT(*) FROM marketplace_settings WHERE store_id NOT IN (SELECT id FROM stores);
-- SELECT COUNT(*) FROM wb_supplies WHERE (store_id NOT IN (SELECT id FROM stores) OR store_id IS NULL) AND status = 'open';
-- SELECT COUNT(*) FROM product_marketplace_links WHERE store_id NOT IN (SELECT id FROM stores);
-- SELECT COUNT(*) FROM orders WHERE store_id NOT IN (SELECT id FROM stores) OR store_id IS NULL;
