import React from 'react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';

beforeEach(()=>localStorage.clear());afterEach(()=>cleanup());
test('demo listing search, low-stock filter and persisted theme',async()=>{
  const user=userEvent.setup();render(<App/>);
  expect(screen.getByRole('heading',{name:'Your store. In focus.'})).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Switch to light mode'}));
  expect(document.documentElement.dataset.theme).toBe('light');expect(localStorage.getItem('jonny-theme')).toBe('light');
  await user.type(screen.getByLabelText('Search listings'),'headphones');
  expect(document.querySelectorAll('tbody tr').length).toBe(1);
  await user.clear(screen.getByLabelText('Search listings'));
  await user.click(screen.getByRole('button',{name:'Low stock',exact:true}));
  expect(document.querySelectorAll('tbody tr').length).toBe(2);
});
test('approve then execute a demo action once, with visible completion',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(within(screen.getByRole('navigation')).getByRole('button',{name:/Automations/}));
  await user.click(screen.getAllByRole('button',{name:'Approve',exact:true})[0]);
  await user.click(screen.getByRole('button',{name:'Execute',exact:false}));
  expect(screen.getByText('completed',{exact:true})).toBeTruthy();
  expect(screen.queryByRole('button',{name:'Execute',exact:false})).toBeNull();
});
test('create a draft, navigate screens and save preferences',async()=>{
  const user=userEvent.setup();render(<App/>);
  await user.click(screen.getByRole('button',{name:'Add product',exact:true}));
  const dialog=screen.getByRole('dialog');
  await user.type(within(dialog).getByLabelText('Product title'),'Test owned product');
  await user.type(within(dialog).getByLabelText('SKU',{exact:true}),'TEST-001');
  await user.click(within(dialog).getByRole('button',{name:'Save product draft'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(within(screen.getByRole('navigation')).getByRole('button',{name:'Products',exact:true}));
  expect(screen.getByText('Test owned product')).toBeTruthy();
  for(const name of ['Listings','Offers','Orders','Activity']){
    await user.click(within(screen.getByRole('navigation')).getByRole('button',{name:new RegExp(name)}));
    expect(document.querySelector('main h1')?.textContent).toContain(name);
  }
  await user.click(screen.getByRole('button',{name:'Settings & connections'}));
  const margin=screen.getByLabelText('Minimum margin (%)');await user.clear(margin);await user.type(margin,'25');
  await user.click(screen.getByRole('button',{name:'Save preferences'}));
  expect((screen.getByLabelText('Minimum margin (%)') as HTMLInputElement).value).toBe('25');
});
