// Dev only (/kit): plain Russian text, outside the i18n rule. Never imported in production.
import { useRef, useState, type ReactNode } from 'react';
import { Bell, Plus } from 'lucide-react';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Drawer,
  Dropdown,
  EmptyState,
  ErrorState,
  IconButton,
  Input,
  Modal,
  ProgressBar,
  Select,
  Skeleton,
  StatCard,
  Table,
  Tabs,
  THEMES,
  ToastProvider,
  Toggle,
  Tooltip,
  applyTheme,
  readStored,
  useToast,
  type ThemeId,
} from '@crystalaid/design-system';
import styles from './Kit.module.css';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.group}>
      <h2 className={styles.heading}>{title}</h2>
      {children}
    </section>
  );
}

interface Person {
  id: string;
  name: string;
  level: string;
  tickets: number;
}

const ROWS: Person[] = [
  { id: '1', name: 'Marta Voss', level: 'Саппорт', tickets: 42 },
  { id: '2', name: 'Dmitri Aldous', level: 'Куратор', tickets: 17 },
  { id: '3', name: 'Ilya Brandt', level: 'Админ', tickets: 5 },
];

interface Wide {
  id: string;
  name: string;
  note: string;
  amount: number;
}

const WIDE_ROWS: Wide[] = [
  { id: 'w1', name: 'Konstantina-Aleksandrovna-Wilhelmina-Ros', note: 'x'.repeat(40), amount: 1000000000 },
];

function ToastButton() {
  const toast = useToast();
  return (
    <Button
      variant="secondary"
      onClick={() => toast.show({ title: 'Готово', description: 'Это уведомление.', tone: 'success' })}
    >
      Показать уведомление
    </Button>
  );
}

function Demo() {
  const [theme, setTheme] = useState<ThemeId>(() => applyTheme(readStored('crystalaid.theme') ?? 'crystal'));
  const [select, setSelect] = useState('ru');
  const [checked, setChecked] = useState(true);
  const [toggled, setToggled] = useState(false);
  const [tab, setTab] = useState('one');
  const [modal, setModal] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const panelMenuRef = useRef<HTMLButtonElement>(null);
  const [modalSelect, setModalSelect] = useState('ru');

  return (
    <div className={styles.kit}>
      <div className={styles.inner}>
        <h1 className={styles.title}>Витрина CrystalAid</h1>

        <Group title="Темы">
          <div className={styles.row}>
            {THEMES.map((t) => (
              <Button
                key={t.id}
                variant={t.id === theme ? 'primary' : 'secondary'}
                aria-pressed={t.id === theme}
                onClick={() => setTheme(applyTheme(t.id))}
              >
                {t.id}
              </Button>
            ))}
          </div>
        </Group>

        <Group title="Кнопки">
          <div className={styles.row}>
            <Button>Основная</Button>
            <Button variant="secondary">Вторичная</Button>
            <Button variant="ghost">Призрачная</Button>
            <Button variant="danger">Опасная</Button>
            <Button size="sm">Малая</Button>
            <Button loading>Загрузка</Button>
            <Button disabled>Недоступна</Button>
            <Tooltip content="Подсказка">
              <IconButton label="Уведомления">
                <Bell size={20} aria-hidden="true" />
              </IconButton>
            </Tooltip>
            <IconButton label="Добавить" disabled>
              <Plus size={20} aria-hidden="true" />
            </IconButton>
          </div>
        </Group>

        <Group title="Аватары и значки">
          <div className={styles.row}>
            <Avatar name="Marta Voss" />
            <Avatar name="Dmitri" />
            <Avatar name="" />
            <Avatar name="Broken" src="/missing.png" />
            <Badge>Нейтральный</Badge>
            <Badge tone="primary">Основной</Badge>
            <Badge tone="success">Успех</Badge>
            <Badge tone="warning">Внимание</Badge>
            <Badge tone="danger">Ошибка</Badge>
          </div>
        </Group>

        <Group title="Карточки и показатели">
          <div className={styles.grid}>
            <Card>Просто карточка</Card>
            <StatCard label="Баланс" value="1 250" hint="токенов" />
            <StatCard label="Уровень" value="Куратор" />
          </div>
          <div className={styles.narrow}>
            <ProgressBar label="Выполнение нормы" value={65} />
            <ProgressBar label="Пусто" value={0} />
            <ProgressBar label="Готово" value={100} />
          </div>
        </Group>

        <Group title="Состояния">
          <div className={styles.grid}>
            <div>
              <Skeleton height={24} width="60%" />
              <Skeleton height={80} />
            </div>
            <EmptyState title="Пока пусто" description="Здесь появятся данные." action={<Button>Действие</Button>} />
            <ErrorState
              title="Что-то пошло не так"
              description="Повторите попытку."
              onRetry={() => {}}
              retryLabel="Повторить"
            />
          </div>
        </Group>

        <Group title="Поля">
          <div className={`${styles.grid} ${styles.narrow}`}>
            <Input label="Обычное" placeholder="Текст" />
            <Input label="С подсказкой" hint="Подсказка под полем" />
            <Input label="С ошибкой" error="Укажите значение" defaultValue="x" />
            <Input label="Недоступное" disabled defaultValue="Нельзя менять" />
            <Select
              label="Язык"
              value={select}
              onChange={setSelect}
              options={[
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
              ]}
            />
            <Select
              label="Недоступный выбор"
              value="ru"
              onChange={() => {}}
              disabled
              options={[{ value: 'ru', label: 'Русский' }]}
            />
            <Checkbox label="Флажок" checked={checked} onChange={setChecked} />
            <Checkbox label="Флажок недоступен" checked={false} onChange={() => {}} disabled />
            <Toggle label="Переключатель" checked={toggled} onChange={setToggled} />
            <Toggle label="Переключатель недоступен" checked onChange={() => {}} disabled />
          </div>
        </Group>

        <Group title="Вкладки">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { id: 'one', label: 'Первая', content: <p>Содержимое первой вкладки.</p> },
              { id: 'two', label: 'Вторая', content: <p>Содержимое второй вкладки.</p> },
            ]}
          />
        </Group>

        <Group title="Таблица">
          <Table<Person>
            caption="Сотрудники"
            expandLabel="Подробнее"
            rowKey={(row) => row.id}
            empty={<EmptyState title="Нет строк" />}
            columns={[
              { id: 'name', header: 'Имя', priority: 'primary', render: (row) => row.name },
              { id: 'level', header: 'Уровень', priority: 'secondary', render: (row) => row.level },
              { id: 'tickets', header: 'Тикеты', priority: 'primary', render: (row) => row.tickets },
            ]}
            rows={ROWS}
          />
          <Table<Person>
            caption="Пустая таблица"
            expandLabel="Подробнее"
            rowKey={(row) => row.id}
            empty={<EmptyState title="Нет строк" />}
            columns={[{ id: 'name', header: 'Имя', priority: 'primary', render: (row) => row.name }]}
            rows={[]}
          />
        </Group>

        <Group title="Длинные значения">
          <Table<Wide>
            caption="Длинные значения"
            expandLabel="Подробнее"
            rowKey={(row) => row.id}
            empty={<EmptyState title="Нет строк" />}
            columns={[
              { id: 'name', header: 'Имя', priority: 'primary', render: (row) => row.name },
              { id: 'note', header: 'Заметка', priority: 'secondary', render: (row) => row.note },
              { id: 'amount', header: 'Сумма', priority: 'secondary', render: (row) => row.amount },
            ]}
            rows={WIDE_ROWS}
          />
        </Group>

        <Group title="Наложения">
          <div className={styles.row}>
            <Dropdown
              triggerRef={menuRef}
              trigger={<Button variant="secondary">Меню</Button>}
              items={[
                { id: 'modal', label: 'Открыть окно', onSelect: () => setModal(true) },
                { id: 'drawer', label: 'Открыть панель', onSelect: () => setDrawer(true) },
                { id: 'off', label: 'Недоступно', onSelect: () => {}, disabled: true },
              ]}
            />
            <Button variant="secondary" onClick={() => setModal(true)}>
              Окно
            </Button>
            <Button variant="secondary" onClick={() => setDrawer(true)}>
              Панель
            </Button>
            <ToastButton />
          </div>
          <Modal
            open={modal}
            onOpenChange={setModal}
            title="Окно"
            description="Пример диалога."
            closeLabel="Закрыть"
            returnFocusRef={menuRef}
          >
            <p>Содержимое окна.</p>
            <Select
              label="Язык в окне"
              value={modalSelect}
              onChange={setModalSelect}
              options={[
                { value: 'ru', label: 'Русский' },
                { value: 'en', label: 'English' },
              ]}
            />
            <ToastButton />
          </Modal>
          <Drawer
            open={drawer}
            onOpenChange={setDrawer}
            title="Панель"
            description="Пример панели."
            closeLabel="Закрыть"
            returnFocusRef={menuRef}
          >
            <p>Содержимое панели.</p>
            <div className={styles.row}>
              <Dropdown
                triggerRef={panelMenuRef}
                trigger={<Button variant="secondary">Меню в панели</Button>}
                items={[
                  { id: 'a', label: 'Первый пункт', onSelect: () => {} },
                  { id: 'b', label: 'Второй пункт', onSelect: () => {} },
                ]}
              />
              <Tooltip content="Подсказка в панели">
                <IconButton label="Справка в панели">
                  <Bell size={20} aria-hidden="true" />
                </IconButton>
              </Tooltip>
            </div>
          </Drawer>
        </Group>
      </div>
    </div>
  );
}

export function Kit() {
  return (
    <ToastProvider closeLabel="Закрыть" regionLabel="Уведомления">
      <Demo />
    </ToastProvider>
  );
}
