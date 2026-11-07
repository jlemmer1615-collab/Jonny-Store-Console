import { test, expect } from '@playwright/test';

test('demo dashboard filters listings, changes theme, and handles action approval',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('All figures are sample data.',{exact:false})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Your store. In focus.'})).toBeVisible();
  await page.getByRole('button',{name:'Switch to light mode'}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.getByRole('button',{name:'Switch to dark mode'}).click();
  await page.getByLabel('Search listings').fill('headphones');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Search listings').clear();
  await page.getByRole('button',{name:'Low stock',exact:true}).click();await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('navigation').getByRole('button',{name:/Automations/}).click();
  await page.getByRole('button',{name:'Approve',exact:true}).first().click();
  await page.getByRole('button',{name:'Execute',exact:false}).first().click();
  await expect(page.getByText('completed',{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});
test('product draft form, settings and all screens work without browser errors',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
  await page.getByRole('button',{name:'Add product',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Product title').fill('Test owned product');await page.getByRole('dialog').getByLabel('SKU',{exact:true}).fill('TEST-001');
  await page.getByRole('button',{name:'Save product draft'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button',{name:'Products',exact:true}).click();await expect(page.getByText('Test owned product')).toBeVisible();
  for(const name of ['Listings','Offers','Orders','Activity']){await page.getByRole('navigation').getByRole('button',{name:new RegExp(name)}).click();await expect(page.locator('main h1')).toContainText(name);}
  await page.getByRole('button',{name:'Settings & connections'}).click();
  await page.getByLabel('Minimum margin (%)').fill('25');await page.getByRole('button',{name:'Save preferences'}).click();await expect(page.getByLabel('Minimum margin (%)')).toHaveValue('25');
  expect(errors).toEqual([]);
});
test('mobile navigation and dialog fit the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await page.getByRole('button',{name:'Open navigation'}).click();await page.getByRole('navigation').getByRole('button',{name:'Products',exact:true}).click();
  await page.getByRole('button',{name:'Add product',exact:true}).click();
  const box=await page.getByRole('dialog').boundingBox();expect(box!.width).toBeLessThanOrEqual(390);expect(box!.height).toBeLessThanOrEqual(844);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
});
