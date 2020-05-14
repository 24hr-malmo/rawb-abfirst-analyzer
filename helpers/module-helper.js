const findNodes = (content, findFunction) => {
    if (!content) {
        return;
    }

    let found = [];

    content.forEach(item => {
        if (findFunction(item)) {
            found.push(item);
        } else if (item.children) {
            const subFound = findNodes(item.children, findFunction);
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
