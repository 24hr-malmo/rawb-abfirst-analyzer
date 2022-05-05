const findNodes = (content, findFunction) => {
    if (!content || !Array.isArray(content)) {
        return;
    }

    let found = [];

    content.forEach(item => {
        const children = item.blocks || item.children;
        if (findFunction(item)) {
            found.push(item);
        }
        if (children) {
            const subFound = findNodes(children, findFunction);
            found.push.apply(found, subFound);
        }
    });

    return found;
};

const findModule = (content, ...moduleNames) => {
    return findNodes(content, node => {
        // Depending on if vc or gutenberg
        const name = node.name || node.blockName;
        return moduleNames.includes(name);
    });
};

exports.findModule = findModule;
