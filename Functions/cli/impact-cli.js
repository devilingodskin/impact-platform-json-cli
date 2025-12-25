#!/usr/bin/env node

/**
 * Visual Change Impact Platform - CLI Version
 * Локальный анализ изменений в конфигурациях без браузера
 * 
 * Usage:
 *   node impact-cli.js <file-a> <file-b> [options]
 *   node impact-cli.js config-v1.json config-v2.json --format=json
 */

const fs = require('fs');
const path = require('path');

// ===== ЦВЕТА ДЛЯ ТЕРМИНАЛА =====
const colors = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
};

// ===== УТИЛИТЫ =====
function colorize(text, color) {
    return `${colors[color] || ''}${text}${colors.reset}`;
}

function box(text, color = 'white') {
    const lines = text.split('\n');
    const maxLen = Math.max(...lines.map(l => l.length));
    const border = '─'.repeat(maxLen + 2);
    
    console.log(colorize(`┌${border}┐`, color));
    lines.forEach(line => {
        const padding = ' '.repeat(maxLen - line.length);
        console.log(colorize(`│ ${line}${padding} │`, color));
    });
    console.log(colorize(`└${border}┘`, color));
}

function icon(type) {
    const icons = {
        added: '✚',
        removed: '✖',
        modified: '⟳',
        critical: '⚠',
        high: '◆',
        medium: '●',
        low: '○',
        success: '✓',
        error: '✗',
        info: 'ℹ',
    };
    return icons[type] || '•';
}

// ===== ПАРСИНГ ФАЙЛОВ =====
function parseYAML(content) {
    const lines = content.split('\n');
    const result = {};
    const stack = [{ obj: result, indent: -1 }];
    
    for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        
        const indent = line.search(/\S/);
        const match = line.trim().match(/^([^:]+):\s*(.*)$/);
        
        if (match) {
            const [, key, value] = match;
            
            while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
                stack.pop();
            }
            
            const parent = stack[stack.length - 1].obj;
            
            if (value) {
                let parsedValue = value.trim();
                if (parsedValue === 'true') parsedValue = true;
                else if (parsedValue === 'false') parsedValue = false;
                else if (!isNaN(parsedValue) && parsedValue !== '') parsedValue = Number(parsedValue);
                else if (parsedValue.startsWith('"') && parsedValue.endsWith('"')) {
                    parsedValue = parsedValue.slice(1, -1);
                } else if (parsedValue.startsWith('[') && parsedValue.endsWith(']')) {
                    try { parsedValue = JSON.parse(parsedValue); } catch {}
                }
                parent[key.trim()] = parsedValue;
            } else {
                parent[key.trim()] = {};
                stack.push({ obj: parent[key.trim()], indent });
            }
        }
    }
    
    return result;
}

function loadFile(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Файл не найден: ${filePath}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    
    if (ext === '.json') {
        return JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
        return parseYAML(content);
    } else {
        // Пробуем JSON по умолчанию
        try {
            return JSON.parse(content);
        } catch {
            throw new Error(`Неподдерживаемый формат файла: ${ext}`);
        }
    }
}

// ===== СРАВНЕНИЕ ОБЪЕКТОВ =====
function compareObjects(objA, objB, path = '') {
    const changes = [];
    const allKeys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})]);
    
    for (const key of allKeys) {
        const currentPath = path ? `${path}.${key}` : key;
        const valueA = objA?.[key];
        const valueB = objB?.[key];
        
        if (!(key in (objA || {}))) {
            changes.push({
                type: 'added',
                path: currentPath,
                value: valueB,
            });
        } else if (!(key in (objB || {}))) {
            changes.push({
                type: 'removed',
                path: currentPath,
                value: valueA,
            });
        } else if (typeof valueA === 'object' && typeof valueB === 'object' && 
                   valueA !== null && valueB !== null &&
                   !Array.isArray(valueA) && !Array.isArray(valueB)) {
            changes.push(...compareObjects(valueA, valueB, currentPath));
        } else if (JSON.stringify(valueA) !== JSON.stringify(valueB)) {
            changes.push({
                type: 'modified',
                path: currentPath,
                oldValue: valueA,
                newValue: valueB,
            });
        }
    }
    
    return changes;
}

// ===== ЛОКАЛЬНЫЙ АНАЛИЗ ВЛИЯНИЯ (БЕЗ AI) =====
function analyzeImpactLocal(changes) {
    const impacts = [];
    
    const criticalPatterns = [
        /^(api[_-]?key|secret|password|token|auth)/i,
        /^(database|db)[_.-](host|url|connection)/i,
        /^required/i,
        /^enabled?$/i,
        /^active$/i,
    ];
    
    const highPatterns = [
        /timeout/i,
        /limit/i,
        /max[_-]?/i,
        /min[_-]?/i,
        /threshold/i,
        /retry/i,
        /^port$/i,
        /^host$/i,
        /^endpoint$/i,
        /^url$/i,
    ];
    
    const mediumPatterns = [
        /^name$/i,
        /^type$/i,
        /^version$/i,
        /^format$/i,
        /^encoding$/i,
        /^locale$/i,
        /^timezone$/i,
    ];
    
    for (const change of changes) {
        const pathLower = change.path.toLowerCase();
        const lastKey = change.path.split('.').pop();
        
        let level = 'low';
        let title = '';
        let description = '';
        let recommendation = '';
        
        // Определяем уровень риска
        if (criticalPatterns.some(p => p.test(lastKey))) {
            level = 'critical';
        } else if (highPatterns.some(p => p.test(lastKey))) {
            level = 'high';
        } else if (mediumPatterns.some(p => p.test(lastKey))) {
            level = 'medium';
        }
        
        // Специфичные проверки
        if (change.type === 'removed') {
            if (level === 'low') level = 'medium';
            title = `Удалено поле: ${lastKey}`;
            description = 'Удаление поля может привести к ошибкам в коде, который его использует.';
            recommendation = 'Убедитесь, что это поле больше не используется в системе.';
        } else if (change.type === 'added') {
            title = `Добавлено поле: ${lastKey}`;
            description = 'Новое поле в конфигурации.';
            if (level === 'critical' || level === 'high') {
                description += ' Требует внимания при развёртывании.';
                recommendation = 'Проверьте, что все компоненты поддерживают новое поле.';
            }
        } else if (change.type === 'modified') {
            title = `Изменено значение: ${lastKey}`;
            
            // Специфичные случаи
            if (/timeout/i.test(lastKey)) {
                const oldVal = Number(change.oldValue);
                const newVal = Number(change.newValue);
                if (!isNaN(oldVal) && !isNaN(newVal)) {
                    if (newVal < oldVal) {
                        level = level === 'low' ? 'medium' : level;
                        description = `Таймаут уменьшен с ${oldVal} до ${newVal}. Возможны ошибки по таймауту.`;
                        recommendation = 'Убедитесь, что новое значение достаточно для выполнения операций.';
                    } else {
                        description = `Таймаут увеличен с ${oldVal} до ${newVal}.`;
                    }
                }
            } else if (/^(enabled?|active)$/i.test(lastKey)) {
                level = 'critical';
                description = `Изменён флаг активности: ${change.oldValue} → ${change.newValue}`;
                recommendation = 'Критическое изменение. Проверьте влияние на работу системы.';
            } else if (/^(port|host)$/i.test(lastKey)) {
                level = 'high';
                description = `Изменены параметры подключения: ${change.oldValue} → ${change.newValue}`;
                recommendation = 'Убедитесь, что новые параметры корректны и доступны.';
            } else {
                description = `Значение изменено с "${change.oldValue}" на "${change.newValue}"`;
            }
        }
        
        // Пропускаем изменения с низким риском если они не критичны
        if (level !== 'low' || change.type === 'removed') {
            impacts.push({
                level,
                path: change.path,
                title,
                description,
                recommendation,
                changeType: change.type,
            });
        }
    }
    
    return impacts;
}

// ===== ВЫВОД РЕЗУЛЬТАТОВ =====
function printHeader() {
    console.log('\n');
    box('Visual Change Impact Platform\nЛокальный анализ изменений', 'cyan');
    console.log('');
}

function printChanges(changes) {
    const added = changes.filter(c => c.type === 'added');
    const removed = changes.filter(c => c.type === 'removed');
    const modified = changes.filter(c => c.type === 'modified');
    
    console.log(colorize('\n━━━ ОБНАРУЖЕННЫЕ ИЗМЕНЕНИЯ ━━━', 'bold'));
    console.log('');
    
    if (added.length > 0) {
        console.log(colorize(`${icon('added')} Добавлено: ${added.length}`, 'green'));
        added.forEach(c => {
            console.log(colorize(`  ${c.path}`, 'gray'));
            console.log(colorize(`    → ${formatValue(c.value)}`, 'green'));
        });
        console.log('');
    }
    
    if (modified.length > 0) {
        console.log(colorize(`${icon('modified')} Изменено: ${modified.length}`, 'yellow'));
        modified.forEach(c => {
            console.log(colorize(`  ${c.path}`, 'gray'));
            console.log(colorize(`    ${formatValue(c.oldValue)}`, 'red') + 
                       colorize(' → ', 'gray') + 
                       colorize(`${formatValue(c.newValue)}`, 'green'));
        });
        console.log('');
    }
    
    if (removed.length > 0) {
        console.log(colorize(`${icon('removed')} Удалено: ${removed.length}`, 'red'));
        removed.forEach(c => {
            console.log(colorize(`  ${c.path}`, 'gray'));
            console.log(colorize(`    ✗ ${formatValue(c.value)}`, 'red'));
        });
        console.log('');
    }
    
    if (changes.length === 0) {
        console.log(colorize('  Изменений не обнаружено', 'green'));
    }
}

function printImpacts(impacts) {
    if (impacts.length === 0) {
        console.log(colorize('\n━━━ АНАЛИЗ ВЛИЯНИЯ ━━━', 'bold'));
        console.log(colorize('\n  ✓ Критических рисков не обнаружено\n', 'green'));
        return;
    }
    
    const critical = impacts.filter(i => i.level === 'critical');
    const high = impacts.filter(i => i.level === 'high');
    const medium = impacts.filter(i => i.level === 'medium');
    const low = impacts.filter(i => i.level === 'low');
    
    console.log(colorize('\n━━━ АНАЛИЗ ВЛИЯНИЯ ━━━', 'bold'));
    console.log('');
    
    const printImpactGroup = (items, label, color, emoji) => {
        if (items.length === 0) return;
        
        console.log(colorize(`${emoji} ${label}: ${items.length}`, color));
        items.forEach((impact, idx) => {
            console.log('');
            console.log(colorize(`  ${impact.title}`, 'bold'));
            console.log(colorize(`  Путь: ${impact.path}`, 'gray'));
            console.log(colorize(`  ${impact.description}`, 'white'));
            if (impact.recommendation) {
                console.log(colorize(`  💡 ${impact.recommendation}`, 'cyan'));
            }
        });
        console.log('');
    };
    
    printImpactGroup(critical, 'КРИТИЧЕСКИЙ', 'red', '⚠');
    printImpactGroup(high, 'Высокий', 'yellow', '◆');
    printImpactGroup(medium, 'Средний', 'blue', '●');
    printImpactGroup(low, 'Низкий', 'gray', '○');
}

function printSummary(changes, impacts) {
    const added = changes.filter(c => c.type === 'added').length;
    const removed = changes.filter(c => c.type === 'removed').length;
    const modified = changes.filter(c => c.type === 'modified').length;
    
    const critical = impacts.filter(i => i.level === 'critical').length;
    const high = impacts.filter(i => i.level === 'high').length;
    const medium = impacts.filter(i => i.level === 'medium').length;
    const low = impacts.filter(i => i.level === 'low').length;
    
    console.log(colorize('\n━━━ ИТОГОВЫЙ ОТЧЁТ ━━━', 'bold'));
    console.log('');
    console.log(`  Всего изменений: ${colorize(changes.length, 'bold')}`);
    console.log(`    ${colorize(`+ ${added}`, 'green')} добавлено`);
    console.log(`    ${colorize(`~ ${modified}`, 'yellow')} изменено`);
    console.log(`    ${colorize(`- ${removed}`, 'red')} удалено`);
    console.log('');
    
    // Определяем общий уровень риска
    let riskLevel = 'Низкий';
    let riskColor = 'green';
    if (critical > 0) {
        riskLevel = 'КРИТИЧЕСКИЙ';
        riskColor = 'red';
    } else if (high > 0) {
        riskLevel = 'Высокий';
        riskColor = 'yellow';
    } else if (medium > 0) {
        riskLevel = 'Средний';
        riskColor = 'blue';
    }
    
    console.log(`  Общий риск: ${colorize(riskLevel, riskColor)}`);
    if (critical > 0) console.log(`    ${colorize(`⚠ ${critical}`, 'red')} критический`);
    if (high > 0) console.log(`    ${colorize(`◆ ${high}`, 'yellow')} высокий`);
    if (medium > 0) console.log(`    ${colorize(`● ${medium}`, 'blue')} средний`);
    if (low > 0) console.log(`    ${colorize(`○ ${low}`, 'gray')} низкий`);
    console.log('');
}

function formatValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') {
        const str = JSON.stringify(value);
        return str.length > 50 ? str.substring(0, 50) + '...' : str;
    }
    const str = String(value);
    return str.length > 50 ? str.substring(0, 50) + '...' : str;
}

// ===== ЭКСПОРТ В JSON =====
function exportReport(changes, impacts, outputPath) {
    const added = changes.filter(c => c.type === 'added').length;
    const removed = changes.filter(c => c.type === 'removed').length;
    const modified = changes.filter(c => c.type === 'modified').length;
    
    const critical = impacts.filter(i => i.level === 'critical').length;
    const high = impacts.filter(i => i.level === 'high').length;
    const medium = impacts.filter(i => i.level === 'medium').length;
    const low = impacts.filter(i => i.level === 'low').length;
    
    const report = {
        generatedAt: new Date().toISOString(),
        summary: {
            total: changes.length,
            added,
            removed,
            modified,
            critical,
            high,
            medium,
            low,
        },
        changes,
        impacts,
    };
    
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(colorize(`\n  ✓ Отчёт сохранён: ${outputPath}\n`, 'green'));
}

// ===== ПАРСИНГ АРГУМЕНТОВ =====
function parseArgs() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.error(colorize('\nОшибка: Недостаточно аргументов\n', 'red'));
        printUsage();
        process.exit(1);
    }
    
    const fileA = args[0];
    const fileB = args[1];
    
    let outputFormat = 'console';
    let outputPath = null;
    
    for (let i = 2; i < args.length; i++) {
        if (args[i].startsWith('--format=')) {
            outputFormat = args[i].split('=')[1];
        } else if (args[i].startsWith('--output=')) {
            outputPath = args[i].split('=')[1];
        } else if (args[i] === '-o' && args[i + 1]) {
            outputPath = args[i + 1];
            i++;
        } else if (args[i] === '--help' || args[i] === '-h') {
            printUsage();
            process.exit(0);
        }
    }
    
    return { fileA, fileB, outputFormat, outputPath };
}

function printUsage() {
    console.log(`
${colorize('Visual Change Impact Platform - CLI', 'cyan')}

${colorize('Использование:', 'bold')}
  node impact-cli.js <файл-A> <файл-B> [опции]

${colorize('Аргументы:', 'bold')}
  <файл-A>    Исходная версия (JSON/YAML)
  <файл-B>    Новая версия (JSON/YAML)

${colorize('Опции:', 'bold')}
  --format=<тип>        Формат вывода (console|json)
  --output=<путь>       Сохранить отчёт в файл
  -o <путь>             Короткая версия --output
  --help, -h            Показать эту справку

${colorize('Примеры:', 'bold')}
  node impact-cli.js config-v1.json config-v2.json
  node impact-cli.js old.yaml new.yaml --output=report.json
  node impact-cli.js a.json b.json --format=json > report.json
`);
}

// ===== ГЛАВНАЯ ФУНКЦИЯ =====
function main() {
    try {
        const { fileA, fileB, outputFormat, outputPath } = parseArgs();
        
        printHeader();
        
        console.log(colorize('Загрузка файлов...', 'gray'));
        const dataA = loadFile(fileA);
        const dataB = loadFile(fileB);
        console.log(colorize(`  ✓ Версия A: ${path.basename(fileA)}`, 'green'));
        console.log(colorize(`  ✓ Версия B: ${path.basename(fileB)}`, 'green'));
        
        console.log(colorize('\nСравнение структур...', 'gray'));
        const changes = compareObjects(dataA, dataB);
        console.log(colorize(`  ✓ Обнаружено изменений: ${changes.length}`, 'green'));
        
        console.log(colorize('\nАнализ влияния...', 'gray'));
        const impacts = analyzeImpactLocal(changes);
        console.log(colorize(`  ✓ Проанализировано рисков: ${impacts.length}`, 'green'));
        
        if (outputFormat === 'json') {
            const result = {
                summary: {
                    total: changes.length,
                    added: changes.filter(c => c.type === 'added').length,
                    removed: changes.filter(c => c.type === 'removed').length,
                    modified: changes.filter(c => c.type === 'modified').length,
                },
                changes,
                impacts,
            };
            console.log(JSON.stringify(result, null, 2));
        } else {
            printChanges(changes);
            printImpacts(impacts);
            printSummary(changes, impacts);
        }
        
        if (outputPath) {
            exportReport(changes, impacts, outputPath);
        }
        
    } catch (error) {
        console.error(colorize(`\n✗ Ошибка: ${error.message}\n`, 'red'));
        process.exit(1);
    }
}

// Запуск
if (require.main === module) {
    main();
}

module.exports = { compareObjects, analyzeImpactLocal, loadFile };